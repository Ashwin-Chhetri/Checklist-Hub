import type { EcologicalProfile } from "../types.js";

export type PlausibilityFlag = "plausible" | "uncertain" | "implausible";

export interface PlausibilityVerdict {
  flag: PlausibilityFlag;
  reason: string;
}

// Deliberately coarse and conservative — this exists only to support expert
// review (see checklistHub_architecture.md Principle 5: "Never Auto-Accept
// Species"), never to filter/reject a species outright. Biomes are matched
// by substring since WWF biome names are long, descriptive strings (e.g.
// "Tropical & Subtropical Moist Broadleaf Forests").
const MARINE_BIOME_HINTS = ["mangrove"];
const ARID_BIOME_HINTS = ["desert", "xeric"];
const FOREST_BIOME_HINTS = ["forest", "broadleaf", "conifer", "taiga"];
const ALPINE_BIOME_HINTS = ["alpine", "montane grassland", "tundra"];

function biomeHasAny(profile: EcologicalProfile, hints: string[]): boolean {
  return profile.ecoregions.some((eco) => hints.some((hint) => eco.biomeName.toLowerCase().includes(hint)));
}

/**
 * Coarse, conservative taxon-group-vs-region-biome plausibility check —
 * a grounding input into the LLM's region/taxon relevance scoring, never a
 * hard filter. Only flags genuinely implausible combinations (e.g. an
 * obligately marine/mangrove-specialist family in a landlocked alpine
 * region); everything else defaults to "plausible" or "uncertain" rather
 * than risk a false "implausible" on a real record.
 */
export function checkEcologicalPlausibility(
  taxonGroup: string,
  classification: { class?: string | null; order?: string | null; family?: string | null },
  profile: EcologicalProfile,
): PlausibilityVerdict {
  if (profile.ecoregions.length === 0) {
    return { flag: "uncertain", reason: "No ecoregion data available for this region." };
  }

  const group = taxonGroup.toLowerCase();
  const familyOrOrder = `${classification.order ?? ""} ${classification.family ?? ""}`.toLowerCase();

  const isAmphibian = group.includes("amphibia") || group.includes("amphibian");
  const isLikelyMarineSpecialist = /delphin|cetacea|phocidae|sirenia/.test(familyOrOrder);

  if (isLikelyMarineSpecialist && !biomeHasAny(profile, MARINE_BIOME_HINTS)) {
    return {
      flag: "implausible",
      reason: "Taxon looks like a marine/coastal specialist, but the region has no mangrove/coastal ecoregion overlap.",
    };
  }

  if (isAmphibian && biomeHasAny(profile, ARID_BIOME_HINTS) && !biomeHasAny(profile, FOREST_BIOME_HINTS)) {
    return {
      flag: "uncertain",
      reason: "Amphibians are uncommon in predominantly desert/xeric regions with no forest ecoregion overlap.",
    };
  }

  if (biomeHasAny(profile, ALPINE_BIOME_HINTS) || biomeHasAny(profile, FOREST_BIOME_HINTS)) {
    return { flag: "plausible", reason: "Region's ecoregion mix is broad/forested enough to support most taxa." };
  }

  return { flag: "plausible", reason: "No specific implausibility signal found." };
}
