import { useQueries, useQuery } from "@tanstack/react-query";
import type { TaxonomicScope } from "@/types/checklist.types";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import type { ScopeTargets } from "@/lib/taxonomy/scopeTargets";
import { deepestTaxon, scopeNodes, scopeSignature } from "@/lib/taxonomy/scopeNodes";
import { fetchScopeTargets } from "@/modules/taxonomy/services/scopeTargetsApi";
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

export function buildDiscoveryContext(
  taxonomicScope: TaxonomicScope,
  deepestTaxonKey: number | null,
  region: RegionValue,
  scopeTargets: ScopeTargets | null = null,
): DiscoveryContext {
  const deepest = deepestTaxon(taxonomicScope);
  return {
    taxonomicScope,
    // Prefer the key the resolver settled on: for a scope ending at a rank
    // GBIF has no taxa at, the caller's `deepestTaxonKey` is null even though
    // the scope is perfectly queryable once expanded.
    deepestTaxonKey: scopeTargets?.includeGbifKeys[0] ?? deepestTaxonKey,
    deepestTaxonName: scopeTargets?.deepestName ?? deepest.name,
    deepestTaxonRank: scopeTargets?.deepestRank ?? deepest.rank,
    gadmGid: region.region_gadm_id || null,
    region,
    scopeTargets,
  };
}

/**
 * Discovers and aggregates the unified species inventory for the selected
 * Region X + Taxon Y across all registered evidence sources.
 *
 * The scope is first resolved into per-source query targets (see
 * `/api/taxonomy/scope-targets`), because a scope can name things a source's
 * API cannot be asked for directly — a superfamily, which GBIF's backbone has
 * no rank for, or an exclusion, which its occurrence search cannot express.
 * Discovery waits on that resolution rather than running a broader query and
 * hoping the aggregator tidies up afterwards.
 *
 * Each evidence provider is then fetched as its own query so the UI can show
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
  const signature = scopeSignature(taxonomicScope);

  const targetsQuery = useQuery({
    queryKey: ["scope-targets", signature],
    queryFn: () => fetchScopeTargets(scopeNodes(taxonomicScope)),
    enabled: signature.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const scopeTargets = targetsQuery.data ?? null;
  const ctx = buildDiscoveryContext(taxonomicScope, deepestTaxonKey, region, scopeTargets);

  // Keyed on the whole scope, not just the deepest GBIF key: adding or
  // removing an exclusion changes which species belong without changing that
  // key at all, and cached results would otherwise be served for it.
  const baseKey = [signature, region.region_gadm_id, region.region_name];

  // Two distinct conditions that must not be conflated.
  //
  // `scopeSelected` means this hook is going to produce an inventory. Callers
  // render a loading state while `isLoading` is true and then dereference
  // `data` directly, so it has to stay true across the WHOLE window where
  // data is absent — including while the scope is still being resolved into
  // query targets, before any provider has been asked to run. Deriving
  // `isLoading` from `providersEnabled` instead opens a gap where nothing is
  // loading and nothing has loaded, which crashes those callers.
  const scopeSelected = ctx.deepestTaxonKey !== null;
  // Providers can only run once the scope's query targets are known.
  const providersEnabled = scopeSelected && !targetsQuery.isLoading;

  const activeProviders = enabledSources
    ? EVIDENCE_PROVIDERS.filter((p) => enabledSources.has(p.key))
    : EVIDENCE_PROVIDERS;

  const providerQueries = useQueries({
    queries: activeProviders.map((provider) => ({
      queryKey: ["species-inventory-source", provider.key, ...baseKey],
      queryFn: () => runProvider(provider, ctx),
      enabled: providersEnabled,
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
    enabled: providersEnabled && allSettled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...aggregateQuery,
    isLoading: scopeSelected && !aggregateQuery.data && !aggregateQuery.error,
    providers,
  };
}
