import {
  getEbirdRegionSpeciesList,
  getEbirdSpeciesList,
  isEbirdConfigured,
  resolveEbirdRegionCode,
} from "@/modules/evidence/services/ebirdEvidence";
import type { DiscoveryContext, EvidenceProvider, RawSpeciesRecord } from "../types";

/**
 * eBird evidence: full historical species checklist for the region (eBird's
 * `/product/spplist`, all-time records — matches the species count shown on
 * eBird's region pages), enriched with observation-record counts and the
 * latest observation date from the recent (30-day) feed — eBird's public API
 * has no all-time per-species count endpoint (that requires the eBird Basic
 * Dataset). Only meaningful when the taxonomic scope is within Aves, and
 * requires an eBird API key. Names are normalized against the backbone by the
 * aggregator.
 */
export const ebirdProvider: EvidenceProvider = {
  key: "ebird",
  label: "eBird",
  // Species count = full all-time checklist (/product/spplist); occurrence
  // count = observation records in the last 30 days (eBird's API max
  // window, floored at 1 per species) — the two numbers are intentionally on
  // different timeframes, hence the explicit label.
  occurrenceLabel: "observations (last 30 days)",

  isEnabled(ctx: DiscoveryContext) {
    const isAves =
      ctx.taxonomicScope.class?.toLowerCase() === "aves" ||
      ctx.deepestTaxonName?.toLowerCase() === "aves";
    if (!isAves) return { enabled: false, reason: "eBird covers birds (Aves) only." };
    if (!isEbirdConfigured()) return { enabled: false, reason: "eBird API key not configured." };
    return { enabled: true };
  },

  async discover(ctx: DiscoveryContext): Promise<RawSpeciesRecord[]> {
    const regionCode = await resolveEbirdRegionCode(ctx.region);
    if (!regionCode) return [];

    const [speciesList, recentObservations] = await Promise.all([
      getEbirdSpeciesList(regionCode),
      getEbirdRegionSpeciesList(regionCode),
    ]);

    const recentByName = new Map(recentObservations.map((o) => [o.scientificName, o]));

    return speciesList
      .filter((s) => s.sciName)
      .map((s) => {
        const recent = recentByName.get(s.sciName!);
        return {
          source: "ebird",
          scientificName: s.sciName!,
          commonName: s.comName,
          // Count of observation records in the last 30 days. Species appear here
          // because they're on eBird's all-time regional checklist (at least one
          // historical record exists somewhere/sometime), but that's presence
          // evidence, not recency — it must NOT be floored to 1 when the recent
          // feed shows 0, or the species would display fabricated "1 observation"
          // evidence for a region/window where none actually occurred.
          occurrenceCount: recent?.occurrenceCount ?? 0,
          latestObservationDate: recent?.eventDate,
          metadata: { ebirdRegionCode: regionCode, ebirdSpeciesCode: s.speciesCode },
        } satisfies RawSpeciesRecord;
      });
  },
};
