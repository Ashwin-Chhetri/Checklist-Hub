import {
  getInatSpeciesCounts,
  getInatYearRange,
  resolveInatPlaceId,
  resolveInatTaxonId,
} from "@/modules/evidence/services/inaturalistEvidence";
import type { DiscoveryContext, EvidenceProvider, RawSpeciesRecord } from "../types";

/**
 * iNaturalist evidence: research-grade-and-other observation counts per
 * species for the selected scope within the region. Resolves the region name
 * → iNat place id, then reads the species_counts breakdown. Public API, no
 * key required.
 *
 * This is the one source that can express the whole scope natively. Its
 * taxonomy carries the sub-ranks GBIF's backbone lacks, so a superfamily
 * scope needs no widening, and `without_taxon_id` applies exclusions
 * server-side — a moth scope is one request, not a filtered bird's-eye query.
 */
export const inaturalistProvider: EvidenceProvider = {
  key: "inaturalist",
  label: "iNaturalist",
  occurrenceLabel: "observations",

  isEnabled(ctx: DiscoveryContext) {
    if (!ctx.scopeTargets?.includeInatId && !ctx.deepestTaxonName) {
      return { enabled: false, reason: "Select a taxonomic scope to query iNaturalist." };
    }
    return { enabled: true };
  },

  async discover(ctx: DiscoveryContext): Promise<RawSpeciesRecord[]> {
    const [resolvedTaxonId, placeId] = await Promise.all([
      // The scope usually arrives with its iNat id already resolved; fall back
      // to a name lookup for scopes saved before ids were stored.
      ctx.scopeTargets?.includeInatId ??
        (ctx.deepestTaxonName
          ? resolveInatTaxonId(ctx.deepestTaxonName, ctx.deepestTaxonRank ?? undefined)
          : Promise.resolve(null)),
      ctx.region.region_name
        ? resolveInatPlaceId(ctx.region.region_name, ctx.region.region_state, ctx.region.region_country)
        : Promise.resolve(null),
    ]);

    if (resolvedTaxonId === null) return [];

    // If a region was specified but we couldn't resolve it to an iNat place, bail out.
    // Falling back to a global (no-place_id) query would return species present anywhere
    // in the world, which produces false positives for the specified region.
    if (ctx.region.region_name && placeId === null) return [];

    const excludeIds = ctx.scopeTargets?.excludeInatIds ?? [];
    const [counts, yearRange] = await Promise.all([
      getInatSpeciesCounts(resolvedTaxonId, placeId!, 200, excludeIds),
      getInatYearRange(resolvedTaxonId, placeId!),
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
