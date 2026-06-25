import { normalizeBatch, type NormalizeInput, type NormalizeResult } from "./normalize";
import { EVIDENCE_PROVIDERS } from "./registry";
import { literatureProvider } from "./providers/literatureProvider";
import type { LiteratureDocument } from "./literature/types";
import type {
  DiscoveryContext,
  EvidenceProvider,
  InventorySpecies,
  ProviderRunResult,
  RawSpeciesRecord,
  SourceKey,
  SourceSummary,
  SpeciesInventory,
  SpeciesRevision,
} from "./types";

type RecordsWithExtras = RawSpeciesRecord[] & { priorChecklists?: LiteratureDocument[] };
type ErrorWithExtras = Error & { disabled?: boolean; priorChecklists?: LiteratureDocument[] };

/** Stable key for normalizing a raw record: prefer the GBIF key, else the name. */
function normalizeKeyFor(record: RawSpeciesRecord): string {
  if (typeof record.gbifKey === "number") return `k:${record.gbifKey}`;
  return `n:${record.scientificName.trim().toLowerCase()}`;
}

/** Run a single provider, isolating failures so one bad source can't sink the rest. */
export async function runProvider(provider: EvidenceProvider, ctx: DiscoveryContext): Promise<ProviderRunResult> {
  const enablement = provider.isEnabled(ctx);
  if (!enablement.enabled) {
    return { source: provider.key, status: "disabled", records: [], message: enablement.reason };
  }
  try {
    const records = (await provider.discover(ctx)) as RecordsWithExtras;
    return {
      source: provider.key,
      status: records.length > 0 ? "ok" : "empty",
      records,
      priorChecklists: records.priorChecklists,
    };
  } catch (err) {
    const e = err as ErrorWithExtras;
    return {
      source: provider.key,
      status: e.disabled ? "disabled" : "error",
      records: [],
      message: e.message,
      priorChecklists: e.priorChecklists,
    };
  }
}

/** Run every registered provider, isolating failures so one bad source can't sink the rest. */
async function runProviders(ctx: DiscoveryContext): Promise<ProviderRunResult[]> {
  return Promise.all(EVIDENCE_PROVIDERS.map((provider) => runProvider(provider, ctx)));
}

/**
 * Aggregate already-run provider results into the unified species inventory.
 *
 * 1. Normalize every raw record against the local GBIF backbone — by backbone
 *    key when available, otherwise by name — resolving synonyms to accepted.
 * 2. Merge records that resolve to the same accepted taxon key into one
 *    inventory species, combining sources, counts, and supporting evidence.
 */
export async function aggregateInventory(ctx: DiscoveryContext, runs: ProviderRunResult[]): Promise<SpeciesInventory> {
  const allRecords = runs.flatMap((r) => r.records);

  // One normalize input per distinct (key|name); reused across duplicate records.
  const inputByNk = new Map<string, NormalizeInput>();
  for (const record of allRecords) {
    const nk = normalizeKeyFor(record);
    if (!inputByNk.has(nk)) {
      inputByNk.set(nk, {
        id: nk,
        gbifKey: typeof record.gbifKey === "number" ? record.gbifKey : undefined,
        name: record.scientificName,
      });
    }
  }

  const kingdomHint = ctx.taxonomicScope.kingdom;
  const normalized = await normalizeBatch([...inputByNk.values()], kingdomHint);

  // Merge into accepted-taxon buckets. Unresolved records fall back to a
  // name-based bucket so they still appear (flagged) in the inventory.
  const buckets = new Map<string, InventorySpecies>();

  for (const record of allRecords) {
    const norm = normalized.get(normalizeKeyFor(record));
    const resolved = norm && norm.taxonKey !== null ? norm : null;
    const bucketKey = resolved
      ? `t:${resolved.taxonKey}`
      : `u:${record.scientificName.trim().toLowerCase()}`;

    let species = buckets.get(bucketKey);
    if (!species) {
      species = buildSpecies(record, resolved);
      buckets.set(bucketKey, species);
    }

    // Stamp this record with its own taxonomic standing — for synonyms/doubtful
    // matches this is the *historical* name/key, not the accepted one.
    const stamped: RawSpeciesRecord = resolved
      ? {
          ...record,
          ownTaxonKey: resolved.ownTaxonId ?? resolved.taxonKey ?? undefined,
          taxonomicStatus: resolved.matchType,
        }
      : { ...record, taxonomicStatus: "none" };

    mergeRecord(species, stamped);
  }

  // A record can land in an "unresolved" (name-keyed) bucket even though
  // another provider's record for the very same species resolved cleanly —
  // e.g. one source supplies a GBIF key that matches the backbone while
  // another only sends a raw name string the backbone lookup couldn't
  // exact-match. Left alone, that produces two InventorySpecies entries
  // sharing the same acceptedName, which breaks everything keyed off it
  // (the species table's React key, the selection Map, etc — this is what
  // surfaces as a "two children with the same key" warning). Fold any such
  // unresolved bucket into the resolved bucket with the same accepted name.
  const resolvedByName = new Map<string, InventorySpecies>();
  for (const candidate of buckets.values()) {
    if (!candidate.unresolved) resolvedByName.set(candidate.acceptedName.trim().toLowerCase(), candidate);
  }
  for (const [key, candidate] of [...buckets.entries()]) {
    if (!candidate.unresolved) continue;
    const match = resolvedByName.get(candidate.acceptedName.trim().toLowerCase());
    if (!match) continue;
    for (const record of candidate.records) mergeRecord(match, record);
    buckets.delete(key);
  }

  for (const species of buckets.values()) {
    species.revisions = buildRevisions(species.records);
  }

  // Require at least one source to report real (>0) occurrence evidence —
  // otherwise a species could enter the checklist purely because some
  // provider returned its name with no actual evidence behind it (e.g. an
  // all-time presence list with no recent activity, or literature extraction
  // with no occurrence count at all). Checks both the accepted-taxon totals
  // and per-revision counts, since a species' only real evidence may be
  // recorded under a historical/synonym name rather than the accepted one.
  const species = [...buckets.values()]
    .filter((s) => hasPositiveEvidence(s))
    .sort((a, b) => {
      if (b.totalOccurrences !== a.totalOccurrences) return b.totalOccurrences - a.totalOccurrences;
      return a.acceptedName.localeCompare(b.acceptedName);
    });

  return {
    species,
    totalSpecies: species.length,
    resolvedSpecies: species.filter((s) => !s.unresolved).length,
    sourceSummary: buildSourceSummary(runs, species),
    priorChecklists: dedupePriorChecklists(runs),
    generatedAt: new Date().toISOString(),
  };
}

/** Run all providers and aggregate in one step. See `runProvider`/`aggregateInventory` for the split version used by the UI to surface per-source progress. */
export async function discoverSpeciesInventory(ctx: DiscoveryContext): Promise<SpeciesInventory> {
  const runs = await runProviders(ctx);
  return aggregateInventory(ctx, runs);
}

/** True if any source — under the accepted name or a historical/synonym name — reported a real (>0) occurrence count. */
function hasPositiveEvidence(species: InventorySpecies): boolean {
  if (species.totalOccurrences > 0) return true;
  return species.revisions.some((rev) => Object.values(rev.occurrenceCounts).some((c) => (c ?? 0) > 0));
}

function buildSpecies(record: RawSpeciesRecord, resolved: NormalizeResult | null): InventorySpecies {
  if (resolved) {
    const canonical = resolved.canonicalName ?? record.scientificName;
    const full = resolved.scientificName;
    const authority =
      full && canonical && full.startsWith(canonical)
        ? full.slice(canonical.length).trim() || undefined
        : undefined;
    return {
      taxonKey: resolved.taxonKey,
      acceptedName: canonical,
      canonicalName: canonical,
      authority,
      commonName: record.commonName,
      rank: resolved.rank,
      family: resolved.classification.family ?? record.family ?? null,
      classification: resolved.classification,
      sources: [],
      occurrenceCounts: {},
      totalOccurrences: 0,
      unresolved: false,
      records: [],
      revisions: [],
    };
  }
  return {
    taxonKey: null,
    acceptedName: record.scientificName,
    canonicalName: record.scientificName,
    commonName: record.commonName,
    rank: null,
    family: record.family ?? null,
    classification: {
      kingdom: null,
      phylum: null,
      class: null,
      order: null,
      family: record.family ?? null,
      genus: null,
    },
    sources: [],
    occurrenceCounts: {},
    totalOccurrences: 0,
    unresolved: true,
    records: [],
    revisions: [],
  };
}

function mergeRecord(species: InventorySpecies, record: RawSpeciesRecord): void {
  species.records.push(record);
  if (!species.sources.includes(record.source)) species.sources.push(record.source);

  // Only the accepted taxon's evidence (or non-GBIF sources with no backbone
  // match) counts toward the inventory totals. Historical/synonym/doubtful
  // records keep their own counts in `species.revisions` instead — discovery
  // never merges across a taxonomic-revision group.
  const countsTowardTotal = record.taxonomicStatus === "accepted" || record.taxonomicStatus === "none";
  if (countsTowardTotal && typeof record.occurrenceCount === "number") {
    const prev = species.occurrenceCounts[record.source] ?? 0;
    species.occurrenceCounts[record.source] = prev + record.occurrenceCount;
    species.totalOccurrences += record.occurrenceCount;
  }
  if (!species.family && record.family) species.family = record.family;
  if (!species.commonName && record.commonName) species.commonName = record.commonName;
  if (record.commonName) {
    if (!species.alternateCommonNames) species.alternateCommonNames = [];
    if (!species.alternateCommonNames.includes(record.commonName)) {
      species.alternateCommonNames.push(record.commonName);
    }
  }

  // Track when a source reported a synonym name rather than the accepted name.
  // The synonym name is the raw name the source sent; acceptedName is what the
  // backbone resolved it to. This lets the workbench flag cross-source synonym
  // usage without auto-renaming or merging anything.
  if (record.taxonomicStatus === "synonym" && record.scientificName !== species.acceptedName) {
    if (!species.sourceSynonyms) species.sourceSynonyms = [];
    const alreadyTracked = species.sourceSynonyms.some(
      (ss) => ss.source === record.source && ss.synonymName === record.scientificName,
    );
    if (!alreadyTracked) {
      species.sourceSynonyms.push({
        source: record.source,
        synonymName: record.scientificName,
        acceptedName: species.acceptedName,
      });
    }
  }
}

/**
 * Group records by (ownTaxonKey, taxonomicStatus) into per-revision entries,
 * each summing occurrence counts within that group only — never across
 * groups, so historical/synonym names retain their own evidence.
 */
function buildRevisions(records: RawSpeciesRecord[]): SpeciesRevision[] {
  const groups = new Map<string, SpeciesRevision>();
  for (const record of records) {
    const taxonKey = record.ownTaxonKey ?? null;
    const status = record.taxonomicStatus ?? "none";
    const groupKey = `${taxonKey}|${status}`;

    let revision = groups.get(groupKey);
    if (!revision) {
      revision = {
        taxonKey,
        scientificName: record.scientificName,
        status,
        occurrenceCounts: {},
      };
      groups.set(groupKey, revision);
    }

    if (typeof record.occurrenceCount === "number") {
      const prev = revision.occurrenceCounts[record.source] ?? 0;
      revision.occurrenceCounts[record.source] = prev + record.occurrenceCount;
    }
  }
  return [...groups.values()];
}

// `literatureProvider` is deliberately unregistered in `registry.ts` (its own
// auto-discovery search is too slow) but its label/occurrenceLabel are still
// reused here for the synthetic "literature" run `useSpeciesInventory`
// merges in once results are manually "Added" from the Deep Search dialog —
// avoids hardcoding the label string a second place.
const FALLBACK_PROVIDER_META = new Map([[literatureProvider.key, literatureProvider]]);

function buildSourceSummary(runs: ProviderRunResult[], species: InventorySpecies[]): SourceSummary[] {
  const providerByKey = new Map(EVIDENCE_PROVIDERS.map((p) => [p.key, p]));

  return runs.map((run) => {
    let speciesCount = 0;
    let totalOccurrences = 0;
    for (const s of species) {
      if (s.sources.includes(run.source)) {
        speciesCount += 1;
        totalOccurrences += s.occurrenceCounts[run.source] ?? 0;
      }
    }
    const provider = providerByKey.get(run.source) ?? FALLBACK_PROVIDER_META.get(run.source);
    return {
      source: run.source,
      label: provider?.label ?? run.source,
      // A provider that returned rows is "ok" even if every row deduped away.
      status: run.status,
      speciesCount,
      totalOccurrences,
      occurrenceLabel: provider?.occurrenceLabel ?? "records",
      message: run.message,
    } satisfies SourceSummary;
  });
}

/** Dedupes prior-checklist documents (by id) across all provider runs. */
function dedupePriorChecklists(runs: ProviderRunResult[]): LiteratureDocument[] {
  const seen = new Map<string, LiteratureDocument>();
  for (const run of runs) {
    for (const doc of run.priorChecklists ?? []) {
      if (!seen.has(doc.id)) seen.set(doc.id, doc);
    }
  }
  return [...seen.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

export type { SourceKey };
