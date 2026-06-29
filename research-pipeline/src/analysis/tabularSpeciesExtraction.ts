import { matchAgainstBackbone } from "./backboneMatch.js";
import type { ExtractedSpeciesRecord } from "../types.js";

/**
 * Matches a binomial (optionally trinomial) ANYWHERE in the line, not just
 * at the start — real bug found via a paper whose species table puts the
 * common name FIRST ("Olive-backed Pipit\tAnthus hodgsoni\tI\tOL\t..."),
 * which a start-anchored pattern never matches at all: it could only find
 * "Genus species (Common Name) — status"-style rows, the opposite column
 * order, silently extracting zero species from an otherwise perfectly
 * readable 42-row table.
 *
 * Dropping the start-anchor on its own isn't safe, though — found via a
 * direct test: it also matches ordinary English noun phrases that happen
 * to start with a capitalized word followed by a lowercase one ("Species
 * richness", "Community parameters", anywhere a stats/header line begins a
 * sentence). The anchor used to filter these out implicitly. Real binomial
 * candidates are now validated against the local GBIF backbone
 * (matchAgainstBackbone) before being trusted — same anti-fabrication
 * discipline proseSpeciesExtraction.ts already uses for the same reason —
 * rather than the line-shape alone deciding what's real.
 *
 * Global flag: a real test against Docling-reconstructed Markdown (a
 * layout-aware PDF parser evaluated and ultimately rejected for this
 * pipeline — pdf-parse matched or beat it on every paper tested, and it
 * crashed outright on larger real PDFs) found rows where its table-structure
 * model merges two adjacent species into one line ("Common Green Eurasian
 * Sparrowhawk# | Cissa chinensis Accipiter nisus | ...") — matching only
 * the first binomial per line silently dropped the second, genuinely real
 * species entirely. matchAll below now captures every occurrence — still
 * relevant for any table-reconstruction tool's output, not just Docling's.
 */
export const BINOMIAL_PATTERN = /([A-Z][a-z]{2,}(?:\s+[a-z][a-z-]{2,}){1,2})\b/g;

/** Occurrence/status vocabulary commonly used in regional checklists — extend as new phrasing comes up in real corpora. Exported for reuse by proseSpeciesExtraction.ts (same vocabulary, different document shape). */
export const STATUS_WORDS = [
  "resident",
  "winter visitor",
  "summer visitor",
  "passage migrant",
  "migrant",
  "vagrant",
  "breeding",
  "endemic",
  "rare",
  "uncommon",
  "common",
];

export interface TabularExtractionResult {
  species: ExtractedSpeciesRecord[];
  /** Fraction (0-1) of candidate lines (binomial-shaped match found) that turned out to backbone-validate as real species — the caller's signal for "is this confident enough to skip the LLM for this paper," and now also what actually rejects noise lines like "Species richness" that merely share the shape. */
  coverage: number;
}

/** Pulls a parenthetical or leading-segment common name plus a status word out of whatever text sits AFTER the matched binomial (the "Genus species (Common Name) — status" column order). */
function extractCommonNameAndStatus(remainder: string): { commonName?: string; occurrence?: string } {
  const trimmed = remainder.trim();
  if (!trimmed) return {};

  const parenMatch = trimmed.match(/\(([^)]+)\)/);
  let commonName: string | undefined;
  if (parenMatch) {
    commonName = parenMatch[1].trim();
  } else {
    const firstSegment = trimmed.split(/[,;|\t.\-—–]/)[0]?.trim();
    const looksLikeStatusWord = firstSegment && STATUS_WORDS.some((word) => firstSegment.toLowerCase() === word);
    // Minimum length excludes single-letter/short-acronym column codes
    // (e.g. a feeding-guild code "I"/"OL"/"FG" sitting right after the
    // binomial in a "Common Name\tGenus species\tguild codes..." table) —
    // real common names are never this short.
    if (firstSegment && !looksLikeStatusWord && /^[A-Z]/.test(firstSegment) && firstSegment.length >= 4 && firstSegment.length < 60) {
      commonName = firstSegment;
    }
  }

  const lowerRemainder = trimmed.toLowerCase();
  const occurrence = STATUS_WORDS.find((word) => lowerRemainder.includes(word));
  return { commonName, occurrence };
}

/** Pulls a plausible common name out of whatever text sits BEFORE the matched binomial (the "Common Name ... Genus species" column order) — strips leading numbering/bullets/markdown-table pipes and trailing column separators/footnote markers (e.g. "Aberrant Bush Warbler#"). */
function extractLeadingCommonName(before: string): string | undefined {
  const cleaned = before
    .replace(/^[\s\d.\-•*)|]+/, "")
    .replace(/[\s:.\-—–\t|]+$/, "")
    .replace(/[#*]+$/, "")
    .trim();
  if (!cleaned || cleaned.length >= 60 || !/^[A-Z]/.test(cleaned)) return undefined;
  return cleaned;
}

interface Candidate {
  scientificName: string;
  before: string;
  after: string;
  line: string;
}

/**
 * Deterministic, non-LLM extraction for literal species tables — the
 * "fastest way" lever for checklist-type documents specifically: free,
 * instant, no rate limit. Tries every line regardless of column order, then
 * validates every candidate against the local GBIF backbone in one batch
 * lookup before accepting any of them (see BINOMIAL_PATTERN's comment for
 * why this validation step is required, not optional, once the line-start
 * anchor was dropped). The caller decides whether the result is confident
 * enough to use as-is (see isConfidentTabularExtraction) or whether the
 * paper should still go through the batched LLM extraction instead.
 */
export function extractTabularSpecies(text: string, taxonHint?: string): TabularExtractionResult {
  const lines = text.split(/\r?\n/);
  const candidates: Candidate[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const match of line.matchAll(BINOMIAL_PATTERN)) {
      if (match.index === undefined) continue;
      candidates.push({
        scientificName: match[1].trim(),
        before: line.slice(0, match.index),
        after: line.slice(match.index + match[0].length),
        line,
      });
    }
  }

  if (candidates.length === 0) return { species: [], coverage: 0 };

  const backboneMatches = matchAgainstBackbone(candidates.map((c) => c.scientificName), taxonHint);
  const species: ExtractedSpeciesRecord[] = [];

  for (const candidate of candidates) {
    const match = backboneMatches.get(candidate.scientificName);
    if (!match) continue;

    // Common-name-first layout ("Common Name\tGenus species\t...") takes
    // priority when there's real text before the binomial — it's the
    // table's own dedicated common-name column, more reliable than
    // whatever follows (which in this layout is usually guild/status
    // codes, not a name). Only look after the binomial when nothing
    // usable precedes it — the "Genus species (Common Name) — status"
    // layout, where the common name and occurrence both come afterward.
    let commonName = extractLeadingCommonName(candidate.before);
    // A second species merged onto the same line (see BINOMIAL_PATTERN's
    // doc comment) has the FIRST species' scientific name sitting in its
    // "before" text, which would otherwise be wrongly attributed as a
    // common name — discard it if it's itself a real validated binomial.
    if (commonName && backboneMatches.has(commonName)) commonName = undefined;
    const fromAfter = extractCommonNameAndStatus(candidate.after);
    commonName = commonName ?? fromAfter.commonName;

    species.push({
      scientificName: match.scientificName,
      commonName,
      occurrence: fromAfter.occurrence,
      sourceSentence: candidate.line,
      backboneValidated: true,
    });
  }

  return { species, coverage: species.length / candidates.length };
}

/** Confidence gate: require both a meaningful absolute count and a high recovery rate against candidate lines, so a mostly-prose document with a couple of incidental binomial-shaped phrases doesn't get treated as "fully covered" by this parser. */
export function isConfidentTabularExtraction(result: TabularExtractionResult, minSpecies = 5, minCoverage = 0.6): boolean {
  return result.species.length >= minSpecies && result.coverage >= minCoverage;
}
