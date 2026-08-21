import { getSpeciesFacetForTaxon, getYearRangeForTaxon, resolveSpeciesKeys } from "@/modules/evidence/services/gbifEvidence";
import { isFamilyInScope } from "@/lib/taxonomy/scopeTargets";
import type { DiscoveryContext, EvidenceProvider, RawSpeciesRecord } from "../types";

/**
 * GBIF evidence: per-species occurrence counts for the selected taxon within
 * the region, via the GBIF occurrence speciesKey facet. Keeps the raw GBIF
 * backbone key on each record so the aggregator can normalize precisely
 * (rather than by name) and merge synonym keys into their accepted taxon.
 *
 * A scope can name something GBIF's own API cannot be asked for directly —
 * a superfamily (its backbone has no such rank) or an exclusion (its
 * occurrence search has no negation). `scopeTargets` resolves both ahead of
 * time: the first into a set of family-level keys to query in turn, the
 * second into family names to drop from the results.
 */
export const gbifProvider: EvidenceProvider = {
  key: "gbif",
  label: "GBIF",
  occurrenceLabel: "observations",

  isEnabled(ctx: DiscoveryContext) {
    if (!queryKeys(ctx).length) {
      return { enabled: false, reason: "Select a taxonomic scope to query GBIF." };
    }
    return { enabled: true };
  },

  async discover(ctx: DiscoveryContext): Promise<RawSpeciesRecord[]> {
    const keys = queryKeys(ctx);
    if (!keys.length) return [];

    // One year range for the whole scope, taken from its broadest key — this
    // is display metadata, not per-species evidence, and querying it per key
    // would multiply requests for no gain.
    const yearRange = await getYearRangeForTaxon(keys[0], ctx.gadmGid ?? undefined);

    // Sequential: a widened scope can expand to dozens of keys, and the GBIF
    // facet endpoint is unthrottled here — firing them in parallel is how you
    // get rate-limited.
    const counts = new Map<number, number>();
    for (const key of keys) {
      const facet = await getSpeciesFacetForTaxon(key, ctx.gadmGid ?? undefined);
      for (const item of facet) {
        counts.set(item.speciesKey, (counts.get(item.speciesKey) ?? 0) + item.count);
      }
    }
    if (counts.size === 0) return [];

    const resolved = await resolveSpeciesKeys([...counts.keys()]);
    const byKey = new Map(resolved.map((r) => [r.key, r]));

    const records: RawSpeciesRecord[] = [];
    for (const [speciesKey, count] of counts) {
      const info = byKey.get(speciesKey);
      // Exclusions and widened includes are both settled here, on the family
      // GBIF reports for the species — the query itself could not express them.
      if (!isFamilyInScope(info?.family, ctx.scopeTargets)) continue;
      records.push({
        source: "gbif",
        scientificName: info?.canonicalName ?? info?.scientificName ?? `Species ${speciesKey}`,
        commonName: info?.vernacularName,
        gbifKey: speciesKey,
        family: info?.family,
        occurrenceCount: count,
        earliestObservationDate: yearRange ? `${yearRange.earliest}-01-01` : undefined,
        latestObservationDate: yearRange ? `${yearRange.latest}-01-01` : undefined,
      });
    }
    return records;
  },
};

/** GBIF keys covering the scope, falling back to the single deepest key. */
function queryKeys(ctx: DiscoveryContext): number[] {
  const fromTargets = ctx.scopeTargets?.includeGbifKeys ?? [];
  if (fromTargets.length) return fromTargets;
  return ctx.deepestTaxonKey === null ? [] : [ctx.deepestTaxonKey];
}
