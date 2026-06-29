import { matchAgainstBackbone, isBackboneAvailable } from "./backboneMatch.js";

/**
 * Detects whether a document's title+abstract actually carries species-record
 * content, as opposed to merely sharing region/taxon keywords with one — the
 * real bug this fixes: "A Summer Place" (a Darjeeling tourism book) passed
 * region+taxon specificity (it mentions Darjeeling and probably birds in
 * passing) and a "has venue/abstract" citability check, with nothing in the
 * pipeline ever asking "does this text actually look like it records
 * species occurrences," vs. a travel guide that happens to mention wildlife.
 */

/**
 * Loose binomial-name shape (Genus species) — global, so every candidate
 * substring is collected for backbone validation below rather than trusting
 * the shape alone. A naive single-match presence check turned out to false-
 * positive on ordinary capitalized two-word phrases (e.g. "Travel guide",
 * "Lonely Planet" — both shaped exactly like "Genus species"), which is
 * exactly the kind of false signal a tourism book would trigger — caught via
 * a direct test before this shipped. Real species mentions are now required
 * to actually resolve against the local GBIF backbone (backboneMatch.ts,
 * already used for LLM-extraction validation elsewhere in this pipeline —
 * synchronous, local SQLite, no network call).
 */
const BINOMIAL_PATTERN = /\b([A-Z][a-z]{2,})\s+([a-z]{3,})\b/g;

function hasValidatedBinomial(text: string): boolean {
  if (!isBackboneAvailable()) return false;
  const candidates = new Set<string>();
  for (const match of text.matchAll(BINOMIAL_PATTERN)) {
    candidates.add(`${match[1]} ${match[2]}`);
  }
  if (candidates.size === 0) return false;
  return matchAgainstBackbone([...candidates]).size > 0;
}

const SPECIES_RECORD_TERMS = [
  "species",
  "specimen",
  "specimens",
  "taxonomy",
  "taxonomic",
  "biodiversity",
  "occurrence",
  "distribution record",
  "new record",
  "first record",
  "avifauna",
  "herpetofauna",
  "ichthyofauna",
  "fauna of",
  "flora of",
  "checklist",
  "inventory",
  "survey of",
  "field survey",
  "abundance",
  "habitat",
  "population",
];

const TOURISM_TERMS = [
  "travel guide",
  "tourism",
  "tourist",
  "places to visit",
  "best time to visit",
  "things to do",
  "must-visit",
  "must visit",
  "hotel",
  "resort",
  "itinerary",
  "sightseeing",
  "vacation",
  "honeymoon",
  "tour package",
  "travelogue",
  "trip to",
  "weekend getaway",
  "summer place",
  "holiday destination",
];

export interface SpeciesRecordSignalResult {
  /** 0-100, fed into scorePreliminaryRelevance as the "is this actually species-record literature" dimension. */
  score: number;
  /**
   * True when tourism/travel-guide language clearly dominates with no
   * offsetting species-record signal — e.g. "A Summer Place" mentioning
   * Darjeeling and birds in passing. preliminaryRelevance.ts caps the
   * overall score hard in this case rather than just weighting it in,
   * because region+taxon keyword overlap alone (0.6 combined weight) was
   * otherwise enough to carry a tourism book over the review threshold —
   * the exact case that motivated this signal existing at all.
   */
  strongTourismSignal: boolean;
  reasons: string[];
}

/**
 * Deterministic, LLM-independent check: starts neutral, rewards
 * species-record vocabulary and binomial-shaped name mentions, penalizes
 * tourism/travel-guide vocabulary. Tourism terms are checked first and
 * weighted heavily — a single strong tourism phrase is usually decisive
 * (a travel guide that happens to mention "birds" is still a travel guide),
 * whereas species-record terms accumulate more gradually since real papers
 * often only need one or two of them.
 */
export function checkSpeciesRecordSignal(text: string): SpeciesRecordSignalResult {
  const lowerText = text.toLowerCase();
  const reasons: string[] = [];
  let score = 50;

  const matchedTourism = TOURISM_TERMS.filter((term) => lowerText.includes(term));
  if (matchedTourism.length > 0) {
    score -= 30 + 10 * (matchedTourism.length - 1);
    reasons.push(`Tourism/travel-guide language found: ${matchedTourism.slice(0, 3).join(", ")}.`);
  }

  const matchedSpeciesTerms = SPECIES_RECORD_TERMS.filter((term) => lowerText.includes(term));
  if (matchedSpeciesTerms.length > 0) {
    score += Math.min(35, 12 * matchedSpeciesTerms.length);
    reasons.push(`Species-record language found: ${matchedSpeciesTerms.slice(0, 3).join(", ")}.`);
  }

  const validatedBinomial = hasValidatedBinomial(text);
  if (validatedBinomial) {
    score += 20;
    reasons.push("Contains a binomial name that resolves against the GBIF backbone.");
  }

  if (matchedTourism.length === 0 && matchedSpeciesTerms.length === 0 && !validatedBinomial) {
    reasons.push("No species-record or tourism signal found either way — content type uncertain.");
  }

  const strongTourismSignal = matchedTourism.length > 0 && matchedSpeciesTerms.length === 0 && !validatedBinomial;

  return { score: Math.max(0, Math.min(100, Math.round(score))), strongTourismSignal, reasons };
}
