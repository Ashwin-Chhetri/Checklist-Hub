import { matchAgainstBackbone } from "./backboneMatch.js";
import { extractLocalityCandidates } from "./localityExtraction.js";
import { STATUS_WORDS } from "./tabularSpeciesExtraction.js";
import type { ExtractedSpeciesRecord } from "../types.js";

/** "Genus species" or "Genus species subspecies", anywhere in running text — looser than tabularSpeciesExtraction's line-start anchor since prose mentions a binomial mid-sentence, not at a line's start. */
const BINOMIAL_PATTERN = /\b([A-Z][a-z]{2,})\s+([a-z][a-z-]{2,})(?:\s+([a-z][a-z-]{2,}))?\b/g;

const DATE_RANGE_PATTERN = /\b(1[5-9]\d{2}|20\d{2})\s*(?:[-–—]|to)\s*(1[5-9]\d{2}|20\d{2})\b/;
/** A bare year only counts as a date if it's introduced by a temporal preposition — otherwise a 4-digit page number, ID, or unrelated count would be mistaken for a survey year. */
const SINGLE_YEAR_CONTEXT_PATTERN = /\b(?:in|during|since|from)\s+(1[5-9]\d{2}|20\d{2})\b/i;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0);
}

function extractDateRange(sentence: string): { from?: string; to?: string } | undefined {
  const rangeMatch = sentence.match(DATE_RANGE_PATTERN);
  if (rangeMatch) return { from: rangeMatch[1], to: rangeMatch[2] };
  const singleMatch = sentence.match(SINGLE_YEAR_CONTEXT_PATTERN);
  if (singleMatch) return { from: singleMatch[1] };
  return undefined;
}

function extractOccurrence(sentence: string): string | undefined {
  const lower = sentence.toLowerCase();
  return STATUS_WORDS.find((word) => lower.includes(word));
}

/** A common name stated immediately after the binomial in parentheses — e.g. "Tragopan satyra (Satyr Tragopan)" — the same convention checklists and papers both use. Anything not in that exact adjacent-parenthetical shape is left unset rather than guessed at. */
function extractCommonName(sentence: string, scientificName: string): string | undefined {
  const idx = sentence.indexOf(scientificName);
  if (idx === -1) return undefined;
  const after = sentence.slice(idx + scientificName.length, idx + scientificName.length + 80);
  const parenMatch = after.match(/^\s*\(([^)]+)\)/);
  return parenMatch ? parenMatch[1].trim() : undefined;
}

/**
 * extractLocalityCandidates just returns every capitalized-phrase-shaped
 * span in the sentence, in order — for a species mention that's usually
 * the species' own genus ("Lophophorus") or its parenthetical common name
 * ("Himalayan Monal") sitting right next to it, not an actual place. Real
 * localities in this corpus are almost always multi-word ("Singhalila
 * National Park", "Darjeeling district"); requiring 2+ words and excluding
 * the genus/common-name tokens themselves is a cheap, deterministic way to
 * avoid that false-positive class entirely rather than guessing.
 */
function pickLocality(sentence: string, scientificName: string, commonName?: string): string | undefined {
  const genus = scientificName.split(" ")[0];
  const candidates = extractLocalityCandidates(sentence).filter((c) => {
    if (!c.name.includes(" ")) return false; // single bare capitalized word — too noisy on its own (pronouns/genus/sentence-starts)
    if (c.name.includes(genus)) return false; // the species' own genus, possibly merged with an adjacent common-name word by the regex's multi-word continuation
    if (commonName && (c.name.includes(commonName) || commonName.includes(c.name))) return false;
    return true;
  });
  return candidates[0]?.name;
}

export interface ProseExtractionResult {
  species: ExtractedSpeciesRecord[];
  /** Count of binomial-shaped candidates found, regardless of backbone validation — the denominator isConfidentProseExtraction uses alongside species.length (the validated subset) to judge whether this parse is trustworthy or mostly noise. */
  candidateCount: number;
}

/**
 * Deterministic, non-LLM extraction for ordinary prose (as opposed to
 * tabularSpeciesExtraction.ts's literal-table case): scans sentence by
 * sentence for binomial-shaped tokens, then validates each one immediately
 * against the local GBIF backbone (matchAgainstBackbone — a SQLite lookup,
 * not a network/LLM call) instead of trusting the regex match on its own.
 * Unvalidated candidates are dropped, never guessed at — same
 * anti-fabrication discipline the LLM path enforces via its prompt, just
 * enforced here structurally instead. This is the "local/offline first,
 * LLM as rare fallback" lever: most papers that explicitly name species in
 * running text never need to reach the rate-limited cloud LLM call at all.
 */
export function extractProseSpecies(text: string, taxonGroup: string): ProseExtractionResult {
  const sentences = splitSentences(text);
  // Binomial-only candidates are the real "how many candidate species
  // mentions did we find" — the denominator for confidence below. The
  // speculative trinomial extension (see comment at its use) is tracked
  // separately and only used to help validation, since it's not a distinct
  // mention site, just a second guess at the same one.
  const primaryCandidates = new Set<string>();
  const trinomialOf = new Map<string, string>();
  const lookupNames = new Set<string>();
  const firstSentenceFor = new Map<string, string>();

  for (const sentence of sentences) {
    for (const match of sentence.matchAll(BINOMIAL_PATTERN)) {
      const binomial = `${match[1]} ${match[2]}`;
      primaryCandidates.add(binomial);
      lookupNames.add(binomial);
      if (!firstSentenceFor.has(binomial)) firstSentenceFor.set(binomial, sentence.trim());

      // The optional trinomial group matches any lowercase word greedily,
      // including ordinary verbs ("Tragopan satyra were conducted..."),
      // which would otherwise turn a real binomial mention into a
      // fabricated trinomial that fails validation and silently drops the
      // real species. Looking up both and letting backbone validation
      // settle it (below) means the genuine binomial still resolves via an
      // exact species match even when the trinomial guess is spurious.
      if (match[3]) {
        trinomialOf.set(binomial, `${binomial} ${match[3]}`);
        lookupNames.add(`${binomial} ${match[3]}`);
      }
    }
  }

  if (primaryCandidates.size === 0) return { species: [], candidateCount: 0 };

  const backboneMatches = matchAgainstBackbone([...lookupNames], taxonGroup);
  const species: ExtractedSpeciesRecord[] = [];

  for (const binomial of primaryCandidates) {
    const trinomial = trinomialOf.get(binomial);
    const match = backboneMatches.get(binomial) ?? (trinomial ? backboneMatches.get(trinomial) : undefined);
    if (!match) continue;

    const sentence = firstSentenceFor.get(binomial) ?? "";
    const commonName = extractCommonName(sentence, binomial);

    species.push({
      scientificName: match.scientificName,
      commonName,
      occurrence: extractOccurrence(sentence),
      location: pickLocality(sentence, match.scientificName, commonName),
      dateRange: extractDateRange(sentence),
      sourceSentence: sentence,
      backboneValidated: true,
    });
  }

  return { species, candidateCount: primaryCandidates.size };
}

/** Confidence gate: at least one backbone-validated species, recovered from a meaningful share of the binomial-shaped candidates the regex found — guards against a sea of garbled/non-species candidates with one fluke real match being treated as a fully covered extraction. */
export function isConfidentProseExtraction(result: ProseExtractionResult, minSpecies = 1, minCoverage = 0.34): boolean {
  if (result.species.length < minSpecies || result.candidateCount === 0) return false;
  return result.species.length / result.candidateCount >= minCoverage;
}
