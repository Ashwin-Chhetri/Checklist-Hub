import { extractTabularSpecies, isConfidentTabularExtraction, type TabularExtractionResult } from "./tabularSpeciesExtraction.js";
import { callLlm, extractJson, availableLanes, type LlmLane } from "./llmClient.js";
import { matchAgainstBackbone } from "./backboneMatch.js";
import type { ExtractedSpeciesRecord } from "../types.js";

/**
 * Locates and extracts a paper's species-inventory table directly, instead
 * of feeding the LLM a char-budget-truncated slice of the whole document
 * (batchExtraction.ts's approach, which can miss the table entirely if it
 * sits past the truncation point, and wastes the prompt on intro/methods
 * text either way).
 *
 * Built from a real test against a Darjeeling bird-diversity paper whose
 * 93-species table runs ~9k characters across several PDF page breaks:
 *   1. A naive substring search for "Table N" fails — the paper cites
 *      "(Table 2)" inline in prose well before the real table appears.
 *   2. A binomial-line-density scanner (no heading anchor at all) also
 *      fails — the real table's row-to-row gap (common name / status code /
 *      per-site counts, each its own line from the PDF's column extraction)
 *      is wider than a dense citation-heavy paragraph elsewhere in the doc,
 *      so density alone picks the wrong region.
 *   3. What works: standalone heading lines (a line that is *only*
 *      "Table N", never embedded in a sentence) reliably bound the real
 *      table, including its "(continued)" repeats across page breaks. Among
 *      several tables in a paper, the one actually worth extracting is
 *      picked by REAL backbone-validated species count *within* each
 *      heading-bounded span (see point 5 below) — combining the one part
 *      of each failed approach that did work.
 *   4. Even once correctly located, asking one LLM call to extract all ~93
 *      rows in a single completion reliably timed out (tested up to 120s on
 *      two different NVIDIA-hosted models). Chunking the located section
 *      into ~3000-character pieces and extracting each independently is
 *      what actually finishes — under 50s per chunk in testing.
 *   5. A second real paper exposed a second bug in point 3's scoring: a
 *      raw binomial-shape line count (not validated against anything) is
 *      fooled by an unrelated stats table (e.g. "Species richness...",
 *      "Shannon-Weiner index...") sitting between two real tables, AND by
 *      ordinary discussion prose that mentions several birds by name in
 *      one paragraph — both can out-score the real species table's own
 *      span purely on shape, with no real species behind most of the
 *      "hits." Fixed by scoring each candidate span with the same
 *      GBIF-backbone-validated extraction (extractTabularSpecies) used for
 *      the real extraction, not a separate looser heuristic — picking by
 *      real validated species count, not shape density.
 */

// Anchored to the start of the line (never matches an inline citation like
// "as shown in Table 2," mid-sentence — those never start a line). Was
// previously `^Table\s+(\d+)\s*$`, requiring the WHOLE line to be just
// "Table N" with nothing else — this missed every real-world heading that
// puts the caption on the same line ("Table 1. Species recorded...", the
// overwhelmingly common style) and every supplementary table numbered with
// a letter prefix ("Table S1." — \d+ alone never matches "S1"). Real bug
// found via a paper whose "Table S1. Bird species recorded during the
// present study..." caption was silently never located, losing 42+ species
// entirely. Now matches the table id (digits, optionally letter-prefixed/
// suffixed, e.g. "1", "S1", "2a") and allows — but doesn't require — a
// caption to follow on the same line.
const HEADING_LINE = /^Table\s+([A-Z]?\d+[a-z]?)\b/;

interface TableHeading {
  line: number;
  /** The captured table id as text (e.g. "1", "S1") — string, not a number, since supplementary tables use a letter prefix. */
  num: string;
}

interface LocatedSection {
  text: string;
  result: TabularExtractionResult;
}

function findHeadings(lines: string[]): TableHeading[] {
  return lines
    .map((l, i) => ({ line: i, m: l.trim().match(HEADING_LINE) }))
    .filter((x): x is { line: number; m: RegExpMatchArray } => x.m !== null)
    .map((x) => ({ line: x.line, num: x.m[1] }));
}

/**
 * Among every "Table N" heading-bounded span in the document (collapsing
 * "Table N" repeats from page breaks into one span per N), returns the one
 * with the most GBIF-backbone-validated species — the actual species
 * inventory, not a diversity-index table, a sampling-site table, or a
 * discussion paragraph that happens to mention several birds by name (see
 * module doc, point 5, for why raw shape-density scoring picked the wrong
 * span on a real paper).
 */
function locateBestTableSection(fullText: string, taxonHint?: string): LocatedSection | null {
  const lines = fullText.split(/\r?\n/);
  const headings = findHeadings(lines);
  if (headings.length === 0) return null;

  const distinctNums = [...new Set(headings.map((h) => h.num))];
  let best: LocatedSection | null = null;

  for (const num of distinctNums) {
    const firstIdx = headings.findIndex((h) => h.num === num);
    const startLine = headings[firstIdx].line;
    const nextDifferent = headings.slice(firstIdx).find((h) => h.num !== num);
    const endLine = nextDifferent ? nextDifferent.line : lines.length;

    const spanText = lines.slice(startLine, endLine).join("\n").trim();
    const result = extractTabularSpecies(spanText, taxonHint);
    if (result.species.length >= 5 && (!best || result.species.length > best.result.species.length)) {
      best = { text: spanText, result };
    }
  }

  return best;
}

/** Accumulates lines into chunks of roughly this many characters — small enough that one LLM completion for the chunk reliably finishes (see module doc, point 4), large enough to keep the chunk count (and so total LLM calls) reasonable. */
const CHUNK_CHAR_BUDGET = 3000;

function chunkByChars(text: string, budget: number): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const line of lines) {
    if (currentLen > 0 && currentLen + line.length > budget) {
      chunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

interface RawSpeciesItem {
  scientificName?: string;
  commonName?: string | null;
  occurrence?: string | null;
}

function buildChunkPrompt(chunkText: string): string {
  return [
    `The text below is one piece of a species-inventory table extracted from a scientific paper (it may be malformed/transposed by the PDF-to-text conversion — read across rows AND columns to find the real per-species data).`,
    `Extract EVERY species explicitly present in this text, using ONLY what is literally here — never general knowledge, never invented entries.`,
    `Respond with ONLY a JSON array, shaped as:`,
    `[{ "scientificName": string, "commonName": string|null, "occurrence": string|null }]`,
    ``,
    `TEXT:`,
    chunkText,
  ].join("\n");
}

async function extractChunkViaLlm(chunkText: string, lane: LlmLane): Promise<ExtractedSpeciesRecord[]> {
  try {
    const content = await callLlm(buildChunkPrompt(chunkText), lane);
    const parsed = extractJson<RawSpeciesItem[]>(content);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RawSpeciesItem & { scientificName: string } => typeof item?.scientificName === "string" && item.scientificName.trim().length > 0)
      .map((item) => ({
        scientificName: item.scientificName.trim(),
        commonName: item.commonName ?? undefined,
        occurrence: item.occurrence ?? undefined,
      }));
  } catch {
    return [];
  }
}

export interface ChunkedTableExtractionResult {
  species: ExtractedSpeciesRecord[];
  /** True when the deterministic regex pass alone was confident enough — no LLM call spent. */
  viaRegexOnly: boolean;
}

/**
 * Locates a paper's species-inventory table and extracts it, deterministic
 * regex first (free, instant — tabularSpeciesExtraction.ts), falling back to
 * chunked LLM extraction only when the regex isn't confident. When more than
 * one LLM lane is configured, chunks are dispatched round-robin across all
 * of them concurrently (see llmClient.ts) instead of serializing through
 * one model. Returns null when no table section can be located at all —
 * callers should fall back to their existing whole-document path.
 *
 * `options.allowLlm` (default true) lets a caller force the regex-only
 * result regardless of whether an LLM lane is configured — used by the
 * default Stage B extraction path (analyzePaper.ts), which skips the LLM
 * call by design, not because no key happens to be set.
 */
export async function extractSpeciesFromTable(
  fullText: string,
  taxonGroup: string,
  options: { allowLlm?: boolean } = {},
): Promise<ChunkedTableExtractionResult | null> {
  const section = locateBestTableSection(fullText, taxonGroup);
  if (!section) return null;

  // Already computed (validated) while scoring which span to pick — no
  // need to re-run extraction against the same text a second time.
  if (isConfidentTabularExtraction(section.result)) {
    return { species: section.result.species, viaRegexOnly: true };
  }

  const lanes = options.allowLlm === false ? [] : availableLanes();
  if (lanes.length === 0) {
    // No LLM configured — the regex pass is still the best we can offer, confident or not.
    return { species: section.result.species, viaRegexOnly: true };
  }

  const chunks = chunkByChars(section.text, CHUNK_CHAR_BUDGET);
  const merged = new Map<string, ExtractedSpeciesRecord>();
  await Promise.all(
    chunks.map(async (chunkText, i) => {
      const lane = lanes[i % lanes.length];
      const records = await extractChunkViaLlm(chunkText, lane);
      for (const record of records) {
        if (!merged.has(record.scientificName)) merged.set(record.scientificName, record);
      }
    }),
  );

  const candidates = [...merged.values()];
  const backboneMatches = matchAgainstBackbone(candidates.map((c) => c.scientificName), taxonGroup);
  const species = candidates.map((c) => {
    const match = backboneMatches.get(c.scientificName);
    return { ...c, scientificName: match?.scientificName ?? c.scientificName, backboneValidated: Boolean(match) };
  });

  return { species, viaRegexOnly: false };
}
