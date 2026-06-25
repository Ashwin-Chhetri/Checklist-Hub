import { matchAgainstBackbone, isBackboneAvailable } from "./backboneMatch.js";
import type { ExtractedSpeciesRecord } from "../types.js";

/**
 * The "Analyzing Species" step's no-LLM enrichment: fills common name, full
 * taxonomic classification, taxonomic status, and synonym->accepted
 * resolution onto already-extracted species records, purely from the local
 * GBIF backbone (no network, no LLM call). Never overwrites
 * `scientificName` itself, even for a synonym — what the source literally
 * said is never silently replaced; `acceptedScientificName` is added
 * alongside it instead.
 *
 * Note: every extraction-cascade step already calls `matchAgainstBackbone`
 * once for its own `backboneValidated` check — this performs a second
 * lookup per name specifically to harvest the richer fields. Deliberate,
 * not an accidental duplication: local SQLite index seeks are sub-
 * millisecond (see backboneMatch.ts's GLOB-vs-LIKE comment), so the repeat
 * cost is negligible against the simplicity of keeping "validate" and
 * "enrich" as separate, independently reusable concerns.
 */
export function enrichSpeciesWithBackbone(species: ExtractedSpeciesRecord[], taxonHint?: string): ExtractedSpeciesRecord[] {
  if (!isBackboneAvailable() || species.length === 0) return species;

  const matches = matchAgainstBackbone(species.map((sp) => sp.scientificName), taxonHint);

  return species.map((sp) => {
    const match = matches.get(sp.scientificName);
    if (!match) return sp;
    return {
      ...sp,
      taxonRank: match.taxonRank ?? undefined,
      taxonomicStatus: match.taxonomicStatus ?? undefined,
      backboneCommonName: match.vernacularName ?? undefined,
      classification: {
        kingdom: match.classification.kingdom ?? undefined,
        phylum: match.classification.phylum ?? undefined,
        class: match.classification.class ?? undefined,
        order: match.classification.order ?? undefined,
        family: match.classification.family ?? undefined,
        genus: match.classification.genus ?? undefined,
      },
      acceptedScientificName: match.acceptedScientificName ?? undefined,
      backboneValidated: true,
    };
  });
}
