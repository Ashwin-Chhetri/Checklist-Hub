import {
  getEbirdRegionSpeciesList,
  getEbirdSpeciesList,
  isEbirdConfigured,
  resolveEbirdRegionCode,
  type EbirdSpeciesListItem,
} from "@/modules/evidence/services/ebirdEvidence";
import { scopeNodes } from "@/lib/taxonomy/scopeNodes";
import type { ScopeNode } from "@/types/checklist.types";
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
 *
 * eBird's region endpoints take no taxon filter at all: they return every bird
 * recorded in the region, whatever the scope. So the scope is applied here
 * instead, against the order/family eBird publishes in its own taxonomy —
 * without which a scope of order Passeriformes would silently import raptors,
 * waterfowl and everything else the region has ever recorded.
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
    if (!coversBirds(ctx)) return { enabled: false, reason: "eBird covers birds (Aves) only." };
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
    const inScope = buildScopeFilter(ctx);

    return speciesList
      .filter((s) => s.sciName && inScope(s))
      .map((s) => {
        const recent = recentByName.get(s.sciName!);
        return {
          source: "ebird",
          scientificName: s.sciName!,
          commonName: s.comName,
          family: s.familySciName,
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

/**
 * Whether the scope sits inside (or contains) Aves. Checking the whole
 * lineage rather than just `scope.class` means a scope set at order
 * Passeriformes or family Muscicapidae still reaches eBird, which the old
 * `class === "aves"` test rejected outright.
 */
function coversBirds(ctx: DiscoveryContext): boolean {
  if (ctx.taxonomicScope.class?.toLowerCase() === "aves") return true;
  if (ctx.deepestTaxonName?.toLowerCase() === "aves") return true;
  return scopeNodes(ctx.taxonomicScope).some(
    (n) => n.mode === "include" && n.name.toLowerCase() === "aves",
  );
}

const eq = (a: string | undefined, b: string) => Boolean(a) && a!.toLowerCase() === b.toLowerCase();

/**
 * A predicate testing an eBird species against the scope, using the only
 * lineage eBird gives us: order, family, and the binomial itself.
 *
 * Ranks between those (suborder, superfamily, subfamily, tribe) can't be
 * tested directly — for those the resolver has already expanded the scope
 * into family names, which is what `includeFamilyNames` carries.
 */
function buildScopeFilter(ctx: DiscoveryContext): (s: EbirdSpeciesListItem) => boolean {
  const nodes = scopeNodes(ctx.taxonomicScope);
  const includes = nodes.filter((n) => n.mode === "include");
  const excludes = nodes.filter((n) => n.mode === "exclude");
  const includeFamilies = ctx.scopeTargets?.includeFamilyNames ?? [];
  const excludeFamilies = ctx.scopeTargets?.excludeFamilyNames ?? [];

  const matchesNode = (s: EbirdSpeciesListItem, node: ScopeNode): boolean => {
    switch (node.rank) {
      case "order":
        return eq(s.order, node.name);
      case "family":
        return eq(s.familySciName, node.name);
      case "genus":
        return Boolean(s.sciName) && s.sciName!.toLowerCase().startsWith(`${node.name.toLowerCase()} `);
      case "species":
      case "subspecies":
        return Boolean(s.sciName) && s.sciName!.toLowerCase().startsWith(node.name.toLowerCase());
      default:
        // Ranks eBird doesn't publish (kingdom…class, and every sub-rank).
        // Anything at or above class is satisfied by the Aves gate already;
        // sub-ranks are handled through includeFamilies below.
        return true;
    }
  };

  return (s) => {
    if (!includes.every((node) => matchesNode(s, node))) return false;
    if (excludes.some((node) => matchesNode(s, node))) return false;
    if (excludeFamilies.some((f) => eq(s.familySciName, f))) return false;
    if (includeFamilies.length && !includeFamilies.some((f) => eq(s.familySciName, f))) return false;
    return true;
  };
}
