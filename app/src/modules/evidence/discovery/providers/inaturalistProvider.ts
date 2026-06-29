import {
  getInatSpeciesCounts,
  getInatYearRange,
  resolveInatPlaceId,
  resolveInatTaxonId,
} from "@/modules/evidence/services/inaturalistEvidence";
import type { DiscoveryContext, EvidenceProvider, RawSpeciesRecord } from "../types";

/**
 * iNaturalist evidence: research-grade-and-other observation counts per
 * species for the deepest selected taxon within the region. Resolves the
 * taxon name → iNat taxon id and the region name → iNat place id, then reads
 * the species_counts breakdown. Public API, no key required.
 */
export const inaturalistProvider: EvidenceProvider = {
  key: "inaturalist",
  label: "iNaturalist",
  occurrenceLabel: "observations",

  isEnabled(ctx: DiscoveryContext) {
    if (!ctx.deepestTaxonName) {
      return { enabled: false, reason: "Select a taxonomic scope to query iNaturalist." };
    }
    return { enabled: true };
  },

  async discover(ctx: DiscoveryContext): Promise<RawSpeciesRecord[]> {
    const [taxonId, placeId] = await Promise.all([
      resolveInatTaxonId(ctx.deepestTaxonName as string, ctx.deepestTaxonRank ?? undefined),
      ctx.region.region_name
        ? resolveInatPlaceId(ctx.region.region_name, ctx.region.region_state, ctx.region.region_country)
        : Promise.resolve(null),
    ]);

    if (taxonId === null) return [];

    // If a region was specified but we couldn't resolve it to an iNat place, bail out.
    // Falling back to a global (no-place_id) query would return species present anywhere
    // in the world, which produces false positives for the specified region.
    if (ctx.region.region_name && placeId === null) return [];

    const [counts, yearRange] = await Promise.all([
      getInatSpeciesCounts(taxonId, placeId!),
      getInatYearRange(taxonId, placeId!),
    ]);
    return counts.map((c) => ({
      source: "inaturalist",
      scientificName: c.scientificName,
      commonName: c.commonName,
      family: c.family,
      occurrenceCount: c.count,
      earliestObservationDate: yearRange.earliest ?? undefined,
      latestObservationDate: yearRange.latest ?? undefined,
      metadata: { inatTaxonId: c.taxonId, inatPlaceId: placeId ?? undefined },
    } satisfies RawSpeciesRecord));
  },
};
