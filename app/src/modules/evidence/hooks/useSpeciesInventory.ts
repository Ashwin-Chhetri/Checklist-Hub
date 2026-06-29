import { useQueries, useQuery } from "@tanstack/react-query";
import type { TaxonomicScope } from "@/types/checklist.types";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import { aggregateInventory, runProvider } from "../discovery/aggregator";
import { EVIDENCE_PROVIDERS } from "../discovery/registry";
import type { DiscoveryContext, ProviderRunResult, RawSpeciesRecord, SourceKey } from "../discovery/types";

/** Live status of one evidence source while the inventory is being discovered. */
export interface ProviderProgress {
  source: SourceKey;
  label: string;
  /** "loading" while the provider's fetch is in flight, "done" once it has settled. */
  state: "loading" | "done";
  run?: ProviderRunResult;
}

const RANKS = ["kingdom", "phylum", "class", "order", "family", "genus", "species"] as const;

/** The deepest selected rank value + rank name, used by name-based providers. */
function deepestTaxon(scope: TaxonomicScope): { name: string | null; rank: string | null } {
  for (let i = RANKS.length - 1; i >= 0; i -= 1) {
    const value = scope[RANKS[i]];
    if (value) return { name: value, rank: RANKS[i] };
  }
  return { name: null, rank: null };
}

export function buildDiscoveryContext(
  taxonomicScope: TaxonomicScope,
  deepestTaxonKey: number | null,
  region: RegionValue,
): DiscoveryContext {
  const deepest = deepestTaxon(taxonomicScope);
  return {
    taxonomicScope,
    deepestTaxonKey,
    deepestTaxonName: deepest.name,
    deepestTaxonRank: deepest.rank,
    gadmGid: region.region_gadm_id || null,
    region,
  };
}

/**
 * Discovers and aggregates the unified species inventory for the selected
 * Region X + Taxon Y across all registered evidence sources. Enabled once a
 * taxonomic scope (deepest taxon key) is set in Step 1.
 *
 * Each evidence provider is fetched as its own query so the UI can show
 * live per-source progress (`providers`) while the final aggregation
 * (normalization + merge) waits for all of them to settle.
 *
 * `enabledSources`, when provided, restricts discovery to that subset of
 * `EVIDENCE_PROVIDERS` — unselected sources are never queried at all (not
 * just hidden from the result). Omitting it queries every provider, same as
 * before this option existed.
 *
 * `literatureRecords`, when provided, is merged in as an extra synthetic
 * provider run (source: "literature") before aggregation — this is how
 * results manually "Added" from the research-pipeline Deep Search dialog
 * join the same normalize/merge/synonym pipeline as GBIF/eBird/iNaturalist,
 * without literature becoming an always-on `EVIDENCE_PROVIDERS` entry (that
 * provider stays disabled — see registry.ts).
 */
export function useSpeciesInventory(
  taxonomicScope: TaxonomicScope,
  deepestTaxonKey: number | null,
  region: RegionValue,
  enabledSources?: Set<SourceKey>,
  literatureRecords?: RawSpeciesRecord[],
) {
  const ctx = buildDiscoveryContext(taxonomicScope, deepestTaxonKey, region);
  const baseKey = [deepestTaxonKey, region.region_gadm_id, region.region_name, taxonomicScope.class];
  const enabled = deepestTaxonKey !== null;

  const activeProviders = enabledSources
    ? EVIDENCE_PROVIDERS.filter((p) => enabledSources.has(p.key))
    : EVIDENCE_PROVIDERS;

  const providerQueries = useQueries({
    queries: activeProviders.map((provider) => ({
      queryKey: ["species-inventory-source", provider.key, ...baseKey],
      queryFn: () => runProvider(provider, ctx),
      enabled,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const providers: ProviderProgress[] = EVIDENCE_PROVIDERS.map((provider) => {
    const activeIndex = activeProviders.indexOf(provider);
    if (activeIndex === -1) {
      return {
        source: provider.key,
        label: provider.label,
        state: "done",
        run: { source: provider.key, status: "disabled", records: [], message: "Skipped (source not selected)" },
      };
    }
    const query = providerQueries[activeIndex];
    return {
      source: provider.key,
      label: provider.label,
      state: query.data ? "done" : "loading",
      run: query.data,
    };
  });

  const runs = providerQueries.map((q) => q.data).filter((r): r is ProviderRunResult => r !== undefined);
  const allSettled = runs.length === activeProviders.length;

  const allRuns: ProviderRunResult[] = literatureRecords?.length
    ? [...runs, { source: "literature", status: "ok", records: literatureRecords }]
    : runs;

  const aggregateQuery = useQuery({
    queryKey: [
      "species-inventory-aggregate",
      ...baseKey,
      [...(enabledSources ?? [])].sort().join(","),
      literatureRecords?.length ?? 0,
    ],
    queryFn: () => aggregateInventory(ctx, allRuns),
    enabled: enabled && allSettled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...aggregateQuery,
    isLoading: enabled && !aggregateQuery.data && !aggregateQuery.error,
    providers,
  };
}
