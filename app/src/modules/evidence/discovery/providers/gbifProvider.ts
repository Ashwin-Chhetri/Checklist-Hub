import { getSpeciesFacetForTaxon, getYearRangeForTaxon, resolveSpeciesKeys } from "@/modules/evidence/services/gbifEvidence";
import type { DiscoveryContext, EvidenceProvider, RawSpeciesRecord } from "../types";

/**
 * GBIF evidence: per-species occurrence counts for the selected taxon within
 * the region, via the GBIF occurrence speciesKey facet. Keeps the raw GBIF
 * backbone key on each record so the aggregator can normalize precisely
 * (rather than by name) and merge synonym keys into their accepted taxon.
 */
export const gbifProvider: EvidenceProvider = {
  key: "gbif",
  label: "GBIF",
  occurrenceLabel: "observations",

  isEnabled(ctx: DiscoveryContext) {
    if (ctx.deepestTaxonKey === null) {
      return { enabled: false, reason: "Select a taxonomic scope to query GBIF." };
    }
    return { enabled: true };
  },

  async discover(ctx: DiscoveryContext): Promise<RawSpeciesRecord[]> {
    const taxonKey = ctx.deepestTaxonKey as number;
    const [facet, yearRange] = await Promise.all([
      getSpeciesFacetForTaxon(taxonKey, ctx.gadmGid ?? undefined),
      getYearRangeForTaxon(taxonKey, ctx.gadmGid ?? undefined),
    ]);
    if (facet.length === 0) return [];

    const resolved = await resolveSpeciesKeys(facet.map((f) => f.speciesKey));
    const byKey = new Map(resolved.map((r) => [r.key, r]));

    return facet.map((item) => {
      const info = byKey.get(item.speciesKey);
      return {
        source: "gbif",
        scientificName: info?.canonicalName ?? info?.scientificName ?? `Species ${item.speciesKey}`,
        commonName: info?.vernacularName,
        gbifKey: item.speciesKey,
        family: info?.family,
        occurrenceCount: item.count,
        earliestObservationDate: yearRange ? `${yearRange.earliest}-01-01` : undefined,
        latestObservationDate: yearRange ? `${yearRange.latest}-01-01` : undefined,
      } satisfies RawSpeciesRecord;
    });
  },
};
