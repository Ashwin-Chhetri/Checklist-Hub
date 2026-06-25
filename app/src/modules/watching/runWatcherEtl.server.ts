import { createServiceClient } from "@/lib/supabase/serviceClient";
import { lookupBackbone } from "@/lib/taxonomy/backbone.server";
import { buildDiscoveryContext } from "@/modules/evidence/hooks/useSpeciesInventory";
import { discoverSpeciesInventory } from "@/modules/evidence/discovery/aggregator";
import { sendEmail } from "@/lib/email";
import { renderWatcherAlertEmail } from "@/lib/email/templates/watcherAlert";
import type { TaxonomicScope } from "@/types/checklist.types";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import type { SourceSummary } from "@/modules/evidence/discovery/types";

const RANKS = ["kingdom", "phylum", "class", "order", "family", "genus", "species"] as const;

/** Mirrors `useSpeciesInventory.ts`'s own deepest-rank walk so the headless ETL
 * resolves the exact same taxon the creation wizard would have. */
function deepestTaxon(scope: TaxonomicScope): { name: string | null; rank: string | null } {
  for (let i = RANKS.length - 1; i >= 0; i -= 1) {
    const value = scope[RANKS[i]];
    if (value) return { name: value, rank: RANKS[i] };
  }
  return { name: null, rank: null };
}

/** Advances from the watcher's own schedule (not "now") so a late cron tick
 * never drifts the cadence forward. */
function addInterval(date: Date, frequency: "weekly" | "monthly"): Date {
  const next = new Date(date);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

interface SpeciesIdentityRow {
  id: string;
  gbif_taxon_key: number | null;
  scientific_name: string;
  common_name: string | null;
  is_active: boolean;
  // jsonb columns — typed loosely since they're read generically here.
  taxonomy: {
    revisions?: Array<{ taxonKey: number | null; scientificName?: string }>;
    synonyms?: Array<{ taxon_id?: number | null; name?: string }>;
    authority_conflicts?: Array<{ taxon_id?: number | null; suggested_name?: string }>;
    accepted_taxon_id?: number;
    accepted_name?: string;
    current_name?: string;
    imported_name?: string;
  } | null;
  evidence: {
    revisions?: Array<{ taxonKey: number | null; scientificName?: string }>;
    occurrence_count?: number;
    sources?: Array<{ source: string; record_count?: number }>;
  } | null;
}

/**
 * Every GBIF taxon key and name a species row is already "known under" —
 * its own accepted key/name plus every synonym, authority-conflict
 * alternative, and discovery-time revision ever recorded for it, regardless
 * of whether that synonym/conflict has since been resolved. A rediscovered
 * record matching ANY of these must never be treated as a new species —
 * the user already has it in the workbench (see SpeciesRevision,
 * TaxonomySynonymEvent, TaxonomyAuthorityConflict in species.types.ts).
 *
 * `commonNames` is a separate, weaker signal: the local GBIF backbone mirror
 * sometimes fails to resolve an orthographic spelling variant a live source
 * (e.g. eBird) reports under (it comes back with no taxon key at all, so it
 * can't be caught by taxonKeys/names above) — e.g. "Ictinaetus malaiensis"
 * vs. the checklist's recorded "Ictinaetus malayensis", both "Black Eagle".
 * A shared common name with an unresolved item is treated as the same
 * species rather than flagging it as a new candidate.
 */
function collectKnownIdentifiers(
  species: SpeciesIdentityRow,
): { taxonKeys: number[]; names: string[]; commonNames: string[] } {
  const taxonKeys: number[] = [];
  const names: string[] = [];
  const commonNames: string[] = [];

  const addKey = (key: number | null | undefined) => {
    if (typeof key === "number") taxonKeys.push(key);
  };
  const addName = (name: string | null | undefined) => {
    if (name && name.trim()) names.push(name.trim().toLowerCase());
  };
  const addCommonName = (name: string | null | undefined) => {
    if (name && name.trim()) commonNames.push(name.trim().toLowerCase());
  };

  addKey(species.gbif_taxon_key);
  addName(species.scientific_name);
  addCommonName(species.common_name);

  const taxonomy = species.taxonomy ?? {};
  addKey(taxonomy.accepted_taxon_id);
  addName(taxonomy.accepted_name);
  addName(taxonomy.current_name);
  addName(taxonomy.imported_name);
  for (const rev of [...(taxonomy.revisions ?? []), ...(species.evidence?.revisions ?? [])]) {
    addKey(rev.taxonKey);
    addName(rev.scientificName);
  }
  for (const syn of taxonomy.synonyms ?? []) {
    addKey(syn.taxon_id);
    addName(syn.name);
  }
  for (const conflict of taxonomy.authority_conflicts ?? []) {
    addKey(conflict.taxon_id);
    addName(conflict.suggested_name);
  }

  return { taxonKeys, names, commonNames };
}

interface WatcherRow {
  id: string;
  checklist_id: string;
  frequency: "weekly" | "monthly";
  next_run_at: string;
}

interface ChecklistRow {
  id: string;
  title: string;
  taxonomic_scope: TaxonomicScope;
  region_name: string | null;
  region_country: string | null;
  region_state: string | null;
  region_district: string | null;
  region_gadm_id: string | null;
  region_osm_type: string | null;
  region_osm_id: string | null;
}

/**
 * Runs one watcher's ETL tick: re-discovers the checklist's Region x Taxon
 * inventory via the same GBIF/eBird/iNaturalist pipeline the creation wizard
 * uses, diffs it against the checklist's current active species (keyed by
 * accepted GBIF taxon key — synonyms of an existing species never count as
 * "new"), stages findings, and alerts subscribers when anything was found.
 * Returns the new `watcher_runs.id`. `manualTrigger` reschedules
 * `next_run_at` from now instead of from the watcher's prior schedule — used
 * by the dialog's "Update Observations" button, which runs the watcher
 * outside its normal cadence (the cron tick passes `manualTrigger: false`
 * so a late automated run never drifts the cadence forward).
 */
export async function runWatcherEtl(
  watcherId: string,
  origin: string,
  manualTrigger = false,
): Promise<string> {
  const supabase = createServiceClient();

  const { data: watcher, error: watcherErr } = await supabase
    .from("watchers")
    .select("id, checklist_id, frequency, next_run_at")
    .eq("id", watcherId)
    .single();
  if (watcherErr || !watcher) throw new Error(`watcher ${watcherId} not found`);
  const watcherRow = watcher as WatcherRow;

  const { data: checklist, error: checklistErr } = await supabase
    .from("checklists")
    .select(
      "id, title, taxonomic_scope, region_name, region_country, region_state, region_district, region_gadm_id, region_osm_type, region_osm_id",
    )
    .eq("id", watcherRow.checklist_id)
    .single();
  if (checklistErr || !checklist) throw new Error(`checklist ${watcherRow.checklist_id} not found`);
  const checklistRow = checklist as ChecklistRow;

  const { data: runRow, error: runInsertErr } = await supabase
    .from("watcher_runs")
    .insert({ watcher_id: watcherRow.id, checklist_id: checklistRow.id, status: "running" })
    .select("id")
    .single();
  if (runInsertErr || !runRow) throw new Error("failed to create watcher_run row");
  const runId = runRow.id as string;

  try {
    // Every species row regardless of is_active — an inactive row (merged,
    // ignored, or rejected) still represents a prior human decision about
    // that taxon, and its identity must keep suppressing rediscovery just
    // like an active row's does (see collectKnownIdentifiers).
    const { data: speciesRows } = await supabase
      .from("species")
      .select("id, gbif_taxon_key, scientific_name, common_name, is_active, taxonomy, evidence")
      .eq("checklist_id", checklistRow.id);

    const knownTaxonKeys = new Set<number>();
    const knownNames = new Set<string>();
    const knownCommonNames = new Set<string>();
    const activeByTaxonKey = new Map<number, string>();
    const activeByName = new Map<string, string>();
    // Only kept when unambiguous (exactly one active species shares a given
    // common name) — set to null on a second sighting so it's never used to
    // attach an observation update to the wrong row.
    const activeByCommonName = new Map<string, string | null>();

    for (const row of (speciesRows ?? []) as SpeciesIdentityRow[]) {
      const { taxonKeys, names, commonNames } = collectKnownIdentifiers(row);
      for (const key of taxonKeys) knownTaxonKeys.add(key);
      for (const name of names) knownNames.add(name);
      for (const name of commonNames) knownCommonNames.add(name);

      if (row.is_active) {
        if (typeof row.gbif_taxon_key === "number") activeByTaxonKey.set(row.gbif_taxon_key, row.id);
        activeByName.set(row.scientific_name.trim().toLowerCase(), row.id);
        if (row.common_name) {
          const key = row.common_name.trim().toLowerCase();
          activeByCommonName.set(key, activeByCommonName.has(key) ? null : row.id);
        }
      }
    }

    // Baseline is the species' OWN evidence jsonb — the same
    // evidence.occurrence_count the workbench table displays as "Occurrence"
    // (see SpeciesRow.tsx) and evidence.sources[].record_count for its
    // per-source breakdown — not the (often unpopulated) evidence_sources
    // relational table, which tracks a separate Evidence-panel concern and
    // previously produced false "grew from 0" diffs for species whose real
    // baseline lived only in this jsonb column.
    const previousTotalBySpecies = new Map<string, number>();
    const previousCountsBySpecies = new Map<string, Record<string, number>>();
    for (const row of (speciesRows ?? []) as SpeciesIdentityRow[]) {
      if (!row.is_active) continue;
      previousTotalBySpecies.set(row.id, row.evidence?.occurrence_count ?? 0);
      const bucket: Record<string, number> = {};
      for (const source of row.evidence?.sources ?? []) {
        if (typeof source.record_count === "number") bucket[source.source] = source.record_count;
      }
      previousCountsBySpecies.set(row.id, bucket);
    }

    const taxonomicScope = checklistRow.taxonomic_scope ?? {};
    const deepest = deepestTaxon(taxonomicScope);
    const deepestTaxonKey = deepest.name
      ? lookupBackbone({ name: deepest.name }, taxonomicScope.kingdom).taxonKey
      : null;

    const region: RegionValue = {
      region_name: checklistRow.region_name ?? "",
      region_district: checklistRow.region_district ?? "",
      region_state: checklistRow.region_state ?? "",
      region_country: checklistRow.region_country ?? "",
      region_gadm_id: checklistRow.region_gadm_id ?? "",
      region_osm_type: checklistRow.region_osm_type ?? undefined,
      region_osm_id: checklistRow.region_osm_id ?? undefined,
    };

    const ctx = buildDiscoveryContext(taxonomicScope, deepestTaxonKey, region);
    const inventory = await discoverSpeciesInventory(ctx);

    let newSpeciesCount = 0;
    let updatedSpeciesCount = 0;

    for (const item of inventory.species) {
      const nameKey = item.acceptedName.trim().toLowerCase();
      // Also check every alternate name discovery collected for this item
      // (e.g. a source-reported synonym) — a record reported only under a
      // name the checklist already knows as a synonym must not surface as new.
      const alternateNameKeys = (item.sourceSynonyms ?? []).map((s) => s.synonymName.trim().toLowerCase());

      // Common-name fallback is restricted to items the backbone couldn't
      // resolve to a taxon key at all — when a scientific-name match exists
      // on either side, that is always the stronger, more specific signal.
      const commonNameKey = item.commonName?.trim().toLowerCase();
      const matchesByCommonNameOnly =
        item.taxonKey === null && !!commonNameKey && knownCommonNames.has(commonNameKey);

      const alreadyKnown =
        (item.taxonKey !== null && knownTaxonKeys.has(item.taxonKey)) ||
        knownNames.has(nameKey) ||
        alternateNameKeys.some((n) => knownNames.has(n)) ||
        matchesByCommonNameOnly;

      const existingId =
        (item.taxonKey !== null ? activeByTaxonKey.get(item.taxonKey) : activeByName.get(nameKey)) ??
        (matchesByCommonNameOnly && commonNameKey ? activeByCommonName.get(commonNameKey) ?? undefined : undefined);

      if (!alreadyKnown && !existingId) {
        newSpeciesCount += 1;
        await supabase.from("watcher_candidate_species").insert({
          watcher_run_id: runId,
          checklist_id: checklistRow.id,
          scientific_name: item.acceptedName,
          common_name: item.commonName ?? null,
          gbif_taxon_key: item.taxonKey,
          family: item.family,
          classification: item.classification,
          sources: item.sources,
          occurrence_counts: item.occurrenceCounts,
          total_occurrences: item.totalOccurrences,
        });
        continue;
      }

      // Already known but not an active row (e.g. it only matches a merged,
      // ignored, or rejected species) — respect that prior decision and skip
      // silently, rather than re-raising it as an observation update with
      // nowhere to attach it in the visible table.
      if (!existingId) continue;

      // Only listed when the source-reported total exceeds what the
      // workbench currently shows for this species — never on a tie or drop,
      // and never based on a single source's count alone.
      const previousTotal = previousTotalBySpecies.get(existingId) ?? 0;
      const newTotal = item.totalOccurrences;
      if (newTotal > previousTotal) {
        const previous = previousCountsBySpecies.get(existingId) ?? {};
        updatedSpeciesCount += 1;
        await supabase.from("watcher_observation_updates").insert({
          watcher_run_id: runId,
          species_id: existingId,
          previous_counts: previous,
          new_counts: item.occurrenceCounts,
          previous_total: previousTotal,
          new_total: newTotal,
          delta: newTotal - previousTotal,
        });
      }
    }

    await supabase
      .from("watcher_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        new_species_count: newSpeciesCount,
        updated_species_count: updatedSpeciesCount,
        source_summary: inventory.sourceSummary,
      })
      .eq("id", runId);

    // A manual run rebases the schedule from now (the user just checked, so
    // the next automatic run should count forward from today); the
    // automated cron tick instead advances from the watcher's own prior
    // schedule so a late tick never drifts the cadence forward.
    const nextRunAt = addInterval(manualTrigger ? new Date() : new Date(watcherRow.next_run_at), watcherRow.frequency);
    await supabase
      .from("watchers")
      .update({ last_run_at: new Date().toISOString(), next_run_at: nextRunAt.toISOString() })
      .eq("id", watcherRow.id);

    if (newSpeciesCount + updatedSpeciesCount > 0) {
      await notifySubscribers(supabase, {
        watcherId: watcherRow.id,
        runId,
        checklistId: checklistRow.id,
        checklistTitle: checklistRow.title,
        newSpeciesCount,
        updatedSpeciesCount,
        sourceSummary: inventory.sourceSummary,
        origin,
      });
    }

    return runId;
  } catch (err) {
    await supabase
      .from("watcher_runs")
      .update({ status: "failed", completed_at: new Date().toISOString(), error_message: (err as Error).message })
      .eq("id", runId);
    throw err;
  }
}

function formatSourceSummaryLine(sourceSummary: SourceSummary[]): string {
  return sourceSummary
    .filter((s) => s.status === "ok" || s.status === "empty")
    .map((s) => `${s.label}: ${s.speciesCount} species`)
    .join(" · ");
}

async function notifySubscribers(
  supabase: ReturnType<typeof createServiceClient>,
  params: {
    watcherId: string;
    runId: string;
    checklistId: string;
    checklistTitle: string;
    newSpeciesCount: number;
    updatedSpeciesCount: number;
    sourceSummary: SourceSummary[];
    origin: string;
  },
): Promise<void> {
  const { watcherId, runId, checklistId, checklistTitle, newSpeciesCount, updatedSpeciesCount, sourceSummary, origin } =
    params;

  const { data: subscribers } = await supabase
    .from("watcher_subscribers")
    .select("user_id")
    .eq("watcher_id", watcherId);
  const subscriberIds = (subscribers ?? []).map((s) => s.user_id as string);

  const { data: profiles } = subscriberIds.length
    ? await supabase.from("profiles").select("id, email").in("id", subscriberIds)
    : { data: [] as { id: string; email: string | null }[] };
  const emailByUserId = new Map((profiles ?? []).map((p) => [p.id as string, p.email as string | null]));

  const reviewUrl = `${origin}/checklists/${checklistId}?watcher_run=${runId}`;
  const sourceSummaryLine = formatSourceSummaryLine(sourceSummary);

  for (const userId of subscriberIds) {
    await supabase.from("notifications").insert({
      user_id: userId,
      checklist_id: checklistId,
      type: "watcher_new_species",
      payload: {
        checklist_title: checklistTitle,
        watcher_run_id: runId,
        new_species_count: newSpeciesCount,
        updated_species_count: updatedSpeciesCount,
      },
    });

    const email = emailByUserId.get(userId);
    if (!email) continue;
    try {
      const rendered = renderWatcherAlertEmail({
        checklistTitle,
        homeUrl: origin,
        toEmail: email,
        newSpeciesCount,
        updatedSpeciesCount,
        sourceSummaryLine,
        reviewUrl,
      });
      await sendEmail({ to: email, ...rendered });
    } catch (err) {
      console.error("Failed to send watcher alert email to %s:", email, err);
    }
  }
}
