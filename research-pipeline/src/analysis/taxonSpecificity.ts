import { BINOMIAL_PATTERN } from "./tabularSpeciesExtraction.js";
import { matchAgainstBackbone } from "./backboneMatch.js";

/**
 * Common-name synonyms for taxonomic groups — most regional literature
 * titles/abstracts say "birds"/"avifauna" rather than the scientific group
 * name "Aves", so a literal-name-only check would miss almost everything.
 * Extend this map as new taxon groups come up.
 */
const TAXON_SYNONYMS: Record<string, string[]> = {
  aves: ["bird", "birds", "avian", "avifauna", "ornitholog"],
  mammalia: ["mammal", "mammals", "mammalian"],
  amphibia: ["amphibian", "amphibians", "frog", "frogs", "toad", "toads"],
  reptilia: ["reptile", "reptiles", "reptilian", "lizard", "lizards", "snake", "snakes"],
  insecta: ["insect", "insects"],
  lepidoptera: ["moth", "moths", "butterfly", "butterflies"],
  pisces: ["fish", "fishes"],
  arachnida: ["spider", "spiders", "arachnid"],
  flora: ["plant", "plants", "flora", "vegetation"],
};

export interface TaxonMatchResult {
  /** 0-100, used directly as RelevanceVerdict.taxonRelevance when no LLM is available. */
  score: number;
  reason: string;
  /** True when a real GBIF-backbone-validated species name found in the text belongs to a clearly different class/order than the requested taxon group — a much stronger negative signal than "the word 'moth' happened to appear," used by preliminaryRelevance.ts for a hard score cap (same pattern as regionSpecificity.ts's wrongCountrySignal). */
  wrongTaxonSignal?: boolean;
}

/**
 * Real bug found via a random multi-taxon test run: bat-diet papers
 * ("Specialized Insectivory: Beetle-Eating and Moth-Eating Molossid Bats",
 * "Trophic Ecology of the Free-tailed Bats Nyctinomops femorosaccus...")
 * scored taxonRelevance: 85 for a Lepidoptera (moth/butterfly) search,
 * purely because the word "moth" appears somewhere — describing what the
 * BATS eat, not what the paper is about. A plain synonym-word match alone
 * can't tell "this document is about moths" apart from "this document
 * mentions moths in passing." Cross-checking any real binomial species
 * name found in the text against the local GBIF backbone (no network/LLM,
 * same local SQLite lookup every extraction step already uses) catches the
 * cases a synonym match alone cannot: if a validated species clearly
 * belongs to a different class/order than requested (Mammalia's
 * "Nyctinomops aurispinosus" when Lepidoptera was requested), that's
 * stronger, more specific evidence than an incidental common-name mention.
 */
function detectConflictingTaxon(text: string, taxonGroup: string): string | undefined {
  const candidates = [...new Set([...text.matchAll(BINOMIAL_PATTERN)].map((m) => m[1] as string))];
  if (candidates.length === 0) return undefined;

  const matches = [...matchAgainstBackbone(candidates, undefined).values()];
  const lowerTaxon = taxonGroup.toLowerCase();
  const matchesRequested = (m: (typeof matches)[number]) =>
    [m.classification.class, m.classification.order, m.classification.phylum, m.classification.kingdom].some(
      (v) => v?.toLowerCase() === lowerTaxon,
    );

  // If ANY validated species in the text genuinely belongs to the
  // requested group, the paper likely does discuss it for real (even if it
  // also mentions other taxa, e.g. predator/prey) — only flag a conflict
  // when there's a validated species and NONE of them are actually the
  // requested group, despite a synonym word matching somewhere in the text.
  if (matches.some(matchesRequested)) return undefined;

  const conflicting = matches.find((m) => !matchesRequested(m));
  if (!conflicting) return undefined;
  return conflicting.classification.class ?? conflicting.classification.order ?? conflicting.classification.kingdom ?? undefined;
}

/**
 * Deterministic, LLM-independent taxon-specificity check: does the text
 * actually mention the requested taxon group (or a recognized common-name
 * synonym), or neither? Without this, taxonRelevance was a flat 50 for
 * every document regardless of subject — which let a moth checklist get
 * selected as the "most recent checklist" for an Aves (bird) search, since
 * nothing distinguished documents actually about the right group from ones
 * that just happened to match the region/checklist-phrase search terms.
 */
export function checkTaxonSpecificity(text: string, taxonGroup: string): TaxonMatchResult {
  const lowerText = text.toLowerCase();
  const lowerTaxon = taxonGroup.toLowerCase();
  const synonyms = TAXON_SYNONYMS[lowerTaxon] ?? [];

  const matched = [lowerTaxon, ...synonyms].find((term) => lowerText.includes(term));
  if (matched) {
    const conflicting = detectConflictingTaxon(text, taxonGroup);
    if (conflicting) {
      return {
        score: 10,
        reason: `Mentions "${matched}", but a real species name found in the text (${conflicting}) belongs to a different group — likely an incidental mention, not the actual subject.`,
        wrongTaxonSignal: true,
      };
    }
    return { score: 85, reason: `Mentions "${matched}".` };
  }
  return { score: 30, reason: `No mention of "${taxonGroup}" or known synonyms found — likely the wrong taxon group.` };
}
