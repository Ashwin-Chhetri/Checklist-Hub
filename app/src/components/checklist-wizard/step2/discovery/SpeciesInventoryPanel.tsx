"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TaxonomicScope } from "@/types/checklist.types";
import { deepestTaxon } from "@/lib/taxonomy/scopeNodes";
import type { RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import type { ParsedSpeciesRow } from "@/modules/checklist/utils/speciesFileParser";
import { useSpeciesInventory } from "@/modules/evidence/hooks/useSpeciesInventory";
import { EVIDENCE_PROVIDERS } from "@/modules/evidence/discovery/registry";
import type { InventorySpecies, SourceKey } from "@/modules/evidence/discovery/types";
import type { LiteratureDocument } from "@/modules/evidence/discovery/literature/types";
import { SOURCE_ACCENT, SOURCE_BG_TINT, SOURCE_HEX, SOURCE_TEXT_COLOR } from "@/modules/evidence/discovery/sourceColors";
import { withLiteratureDateRange } from "@/modules/research/services/literatureCandidatePool";
import { discoverySpeciesKey } from "./FamilySpeciesList";
import { SourceCreditLinks } from "./SourceCreditLinks";
import type { RawSpeciesRecord } from "@/modules/evidence/discovery/types";

/** First literature record's source URL (or DOI link) for this species, if any. */
function findLiteratureLink(records: RawSpeciesRecord[]): string | null {
  for (const record of records) {
    if (record.source !== "literature") continue;
    const url = record.metadata?.url;
    if (typeof url === "string" && url) return url;
    const doi = record.metadata?.doi;
    if (typeof doi === "string" && doi) return `https://doi.org/${doi}`;
  }
  return null;
}

/**
 * Builds a deep link to view this species on each contributing source's own
 * site, from whatever per-record metadata each provider captured during
 * discovery (GBIF taxon key, iNaturalist taxon id, eBird species code,
 * literature URL/DOI) — so the workbench's Evidence tags can link straight to
 * the source instead of just naming it.
 */
function findSourceLinks(
  records: RawSpeciesRecord[],
  acceptedTaxonKey: number | null,
): Partial<Record<SourceKey, string>> {
  const links: Partial<Record<SourceKey, string>> = {};
  for (const record of records) {
    if (links[record.source]) continue;
    if (record.source === "gbif") {
      const key = record.gbifKey ?? acceptedTaxonKey;
      if (key) links.gbif = `https://www.gbif.org/species/${key}`;
    } else if (record.source === "inaturalist") {
      const inatTaxonId = record.metadata?.inatTaxonId;
      if (typeof inatTaxonId === "number") links.inaturalist = `https://www.inaturalist.org/taxa/${inatTaxonId}`;
    } else if (record.source === "ebird") {
      const code = record.metadata?.ebirdSpeciesCode;
      if (typeof code === "string" && code) links.ebird = `https://ebird.org/species/${code}`;
    } else if (record.source === "literature") {
      const link = findLiteratureLink([record]);
      if (link) links.literature = link;
    }
  }
  // GBIF's own taxon key is always known once resolved, even if no individual
  // GBIF record carried it on this pass — fall back to it directly.
  if (!links.gbif && acceptedTaxonKey) links.gbif = `https://www.gbif.org/species/${acceptedTaxonKey}`;
  return links;
}

export interface SpeciesInventoryPanelProps {
  taxonomicScope: TaxonomicScope;
  deepestTaxonKey: number | null;
  region: RegionValue;
  selected: Map<string, ParsedSpeciesRow>;
  onSelectionChange: (next: Map<string, ParsedSpeciesRow>) => void;
  /** Reports the full discovered inventory totals (independent of selection), so Step 5 can summarize what Validate found. */
  onInventoryLoaded?: (totals: { totalSpecies: number; totalOccurrences: number } | null) => void;
  /** Restricts discovery to this subset of sources; omit to query everything (default). */
  enabledSources?: Set<SourceKey>;
  /** Species with these GBIF taxon keys are excluded from the inventory entirely (already in the checklist). */
  excludeTaxonKeys?: Set<number>;
  /** Species whose accepted/canonical name (lowercased) matches are excluded entirely (already in the checklist). */
  excludeNames?: Set<string>;
  /** Species the user uploaded directly (CSV/TSV/JSON/Excel) — merged into the inventory and counted/filterable separately from discovered evidence. */
  uploadedRows?: ParsedSpeciesRow[];
  /** Species "Added" from the Deep Search dialog — merged into the same aggregation pass as discovered evidence (see useSpeciesInventory), so synonym/conflict detection applies to literature exactly like any other source. */
  literatureRecords?: RawSpeciesRecord[];
}

// "literature" is appended explicitly rather than derived from
// EVIDENCE_PROVIDERS — its auto-discovery provider stays deliberately
// disabled in registry.ts (too slow), but once literature records are merged
// in via useSpeciesInventory's literatureRecords param, the filter tab and
// table column need to exist to show them.
const SOURCE_ORDER: SourceKey[] = [...EVIDENCE_PROVIDERS.map((p) => p.key), "literature"];
const SOURCE_LABEL: Record<SourceKey, string> = {
  ...(Object.fromEntries(EVIDENCE_PROVIDERS.map((p) => [p.key, p.label])) as Record<SourceKey, string>),
  literature: "Literature",
};

/** Shared grid template for the virtualized species table — header and rows must stay in sync, so column widths live in one place. */
const TABLE_GRID_TEMPLATE = `32px minmax(160px,2fr) minmax(120px,1.2fr) minmax(100px,1fr) ${SOURCE_ORDER.map(() => "70px").join(" ")} 130px`;

type ViewMode = "list" | "chart";
type SortMode = "default" | "occurrence-desc" | "occurrence-asc";

/** A user-uploaded row not matched to any discovered species, shown as its own (unresolved) inventory entry. */
function uploadedRowToInventorySpecies(row: ParsedSpeciesRow): InventorySpecies {
  return {
    taxonKey: null,
    acceptedName: row.scientific_name,
    canonicalName: row.scientific_name,
    commonName: row.common_name,
    rank: null,
    family: null,
    classification: { kingdom: null, phylum: null, class: null, order: null, family: null, genus: null },
    sources: [],
    occurrenceCounts: {},
    totalOccurrences: row.occurrence_count ?? 0,
    unresolved: true,
    records: [],
    revisions: [],
  };
}

const MIN_PLAUSIBLE_YEAR = 1700;

function plausibleYear(dateStr: string | undefined): number | null {
  if (!dateStr || Number.isNaN(Date.parse(dateStr))) return null;
  const year = new Date(dateStr).getFullYear();
  if (year < MIN_PLAUSIBLE_YEAR || year > new Date().getFullYear() + 1) return null;
  return year;
}

/**
 * Earliest/latest year across both the user's uploaded event dates AND every
 * discovered species' earliest/latest observation dates from
 * GBIF/eBird/iNaturalist/literature/etc, for the "Date Range" stat — so it
 * reflects the full inventory's historical span, not just what was uploaded
 * or whatever a single recent-window source happens to report.
 */
function combinedDateRange(rows: ParsedSpeciesRow[], species: InventorySpecies[]): { earliest: number; latest: number } | null {
  const years: number[] = [];
  for (const r of rows) {
    const year = plausibleYear(r.event_date);
    if (year !== null) years.push(year);
  }
  for (const s of species) {
    for (const record of s.records) {
      const latestYear = plausibleYear(record.latestObservationDate);
      if (latestYear !== null) years.push(latestYear);
      const earliestYear = plausibleYear(record.earliestObservationDate);
      if (earliestYear !== null) years.push(earliestYear);
    }
  }
  if (years.length === 0) return null;
  years.sort((a, b) => a - b);
  return { earliest: years[0], latest: years[years.length - 1] };
}

/** Every distinct literature paper that contributed to this species, deduped by title — see `toLiteratureRecords` (one RawSpeciesRecord per species per paper). Feeds `ParsedSpeciesRow.publications`, which `buildSpeciesPayload.server.ts` writes into the `publications` table for the Evidence panel's full source list. */
function literaturePublications(records: RawSpeciesRecord[]): ParsedSpeciesRow["publications"] {
  const seen = new Map<string, NonNullable<ParsedSpeciesRow["publications"]>[number]>();
  for (const record of records) {
    if (record.source !== "literature") continue;
    const title = record.metadata?.reference;
    if (typeof title !== "string" || !title || seen.has(title)) continue;
    const doi = record.metadata?.doi;
    const url = record.metadata?.url;
    seen.set(title, {
      title,
      year: record.latestObservationDate ? new Date(record.latestObservationDate).getFullYear() : undefined,
      doi: typeof doi === "string" ? doi : undefined,
      link: typeof url === "string" ? url : typeof doi === "string" ? `https://doi.org/${doi}` : undefined,
    });
  }
  return seen.size > 0 ? [...seen.values()] : undefined;
}

function inventorySpeciesToRow(species: InventorySpecies): ParsedSpeciesRow {
  const synonymRevisions = species.revisions.filter(
    (r) => r.status === "synonym" || r.status === "doubtful",
  );
  const taxonomy_synonyms = synonymRevisions.map((r) => ({
    event_type: r.status === "synonym" ? "synonym" : "reassignment",
    name: r.scientificName,
    authority: "GBIF",
  }));

  // totalOccurrences only counts accepted records; synonym/doubtful records are
  // tracked in revisions instead (to avoid double-counting when both name forms are
  // present). When all contributing records were synonyms, totalOccurrences is 0 —
  // fall back to summing revision counts so evidence is preserved on ingestion.
  let occurrence_count: number | undefined = species.totalOccurrences || undefined;
  let occurrence_counts: Partial<Record<SourceKey, number>> = species.occurrenceCounts;

  if (!species.totalOccurrences && species.revisions.length > 0) {
    const fallbackCounts: Partial<Record<SourceKey, number>> = {};
    for (const rev of species.revisions) {
      for (const [src, n] of Object.entries(rev.occurrenceCounts ?? {})) {
        fallbackCounts[src as SourceKey] = (fallbackCounts[src as SourceKey] ?? 0) + (n as number);
      }
    }
    const fallbackTotal = Object.values(fallbackCounts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
    if (fallbackTotal > 0) {
      occurrence_count = fallbackTotal;
      occurrence_counts = { ...fallbackCounts, ...occurrence_counts };
    }
  }

  return {
    scientific_name: species.canonicalName ?? species.acceptedName,
    scientific_name_authorship: species.authority,
    common_name: species.commonName ?? undefined,
    alternate_common_names: species.alternateCommonNames?.length ? species.alternateCommonNames : undefined,
    occurrence_count,
    gbif_taxon_key: species.taxonKey,
    canonical_name: species.canonicalName,
    classification: species.classification,
    sources: species.sources,
    occurrence_counts,
    source_links: findSourceLinks(species.records, species.taxonKey),
    revisions: species.revisions,
    unresolved: species.unresolved,
    taxonomy_synonyms: taxonomy_synonyms.length > 0 ? taxonomy_synonyms : undefined,
    publications: literaturePublications(species.records),
  };
}

/**
 * Unified species inventory for the selected Region X + Taxon Y: total
 * species count, evidence summary by source, source presence matrix, and a
 * selectable species list combining GBIF, eBird, iNaturalist, and Literature
 * evidence (normalized against the local GBIF backbone).
 */
export function SpeciesInventoryPanel({
  taxonomicScope,
  deepestTaxonKey,
  region,
  selected,
  onSelectionChange,
  onInventoryLoaded,
  enabledSources,
  excludeTaxonKeys,
  excludeNames,
  uploadedRows = [],
  literatureRecords = [],
}: SpeciesInventoryPanelProps) {
  const [familyFilter, setFamilyFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [sourceFilter, setSourceFilter] = useState<Set<SourceKey>>(new Set());
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [uploadedOnly, setUploadedOnly] = useState(false);
  const [showDateRangeInfo, setShowDateRangeInfo] = useState(false);
  const inventory = useSpeciesInventory(taxonomicScope, deepestTaxonKey, region, enabledSources, literatureRecords);

  // The filter button only renders while there are uploaded rows — reset it
  // so the filter doesn't stay silently active once that button disappears.
  useEffect(() => {
    if (uploadedRows.length === 0) setUploadedOnly(false);
  }, [uploadedRows.length]);

  // Debounce the search box so large inventories (5k-50k+ rows) don't re-run
  // the filter/sort pass on every keystroke — that synchronous work on the
  // full array is what made typing feel like it froze the tab.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearchTerm(searchTerm), 200);
    return () => clearTimeout(id);
  }, [searchTerm]);

  // Every uploaded scientific name, for tagging/filtering rows in the merged
  // inventory below regardless of whether they were also independently
  // discovered by an evidence source.
  const uploadedNameSet = useMemo(
    () => new Set(uploadedRows.map((r) => r.scientific_name.trim().toLowerCase())),
    [uploadedRows],
  );

  // When excludeTaxonKeys/excludeNames are provided (Add Species dialog, to skip
  // species already in the checklist), filter them out of the discovered
  // inventory entirely — they're never shown, selectable, or counted. With
  // neither prop given (the wizard's own usage), this is just inventory.data.species.
  // Uploaded rows that weren't independently discovered are appended as their
  // own (unresolved) entries so the table/cards reflect them too.
  const effectiveSpecies = useMemo(() => {
    const all = inventory.data?.species ?? [];
    const discovered = !excludeTaxonKeys && !excludeNames
      ? all
      : all.filter((s) => {
          const keyMatch = s.taxonKey != null && excludeTaxonKeys?.has(s.taxonKey);
          const nameMatch =
            excludeNames?.has(s.acceptedName.toLowerCase()) || excludeNames?.has(s.canonicalName.toLowerCase());
          return !keyMatch && !nameMatch;
        });

    const discoveredNames = new Set(discovered.map((s) => s.acceptedName.trim().toLowerCase()));
    const seenUploadOnly = new Set<string>();
    const uploadOnly: InventorySpecies[] = [];
    for (const row of uploadedRows) {
      const key = row.scientific_name.trim().toLowerCase();
      if (discoveredNames.has(key) || seenUploadOnly.has(key)) continue;
      seenUploadOnly.add(key);
      uploadOnly.push(uploadedRowToInventorySpecies(row));
    }
    return [...discovered, ...uploadOnly];
  }, [inventory.data, excludeTaxonKeys, excludeNames, uploadedRows]);

  const dateRange = useMemo(
    () => combinedDateRange(uploadedRows, effectiveSpecies),
    [uploadedRows, effectiveSpecies],
  );

  useEffect(() => {
    if (!onInventoryLoaded) return;
    if (!inventory.data) {
      onInventoryLoaded(null);
      return;
    }
    const totalOccurrences = effectiveSpecies.reduce((sum, s) => sum + s.totalOccurrences, 0);
    onInventoryLoaded({ totalSpecies: effectiveSpecies.length, totalOccurrences });
  }, [inventory.data, effectiveSpecies, onInventoryLoaded]);

  // Default to including the full discovered inventory in the checklist
  // (opt-out model) — auto-select everything the first time results load for
  // this scope/region, unless selections were already restored (e.g. from a
  // saved draft). Users can then deselect individual species or whole
  // families.
  //
  // Literature is added later, via an explicit "Add to Checklist" click in
  // the Deep Search dialog, which can happen before this scope's initial
  // auto-select has ever run (e.g. the user adds literature on Step 2, then
  // visits Step 3 for the first time). Both cases are handled in this SAME
  // effect — not two separate ones — deliberately: two effects independently
  // computing `next = new Map(selected)` and each calling onSelectionChange
  // race on the very first mount, since neither sees the other's pending
  // update before computing its own snapshot. The second effect's call would
  // then win with only literature species selected, silently dropping every
  // other source's selection — a real bug this fixed. Combining them into
  // one effect with one `next` Map and one onSelectionChange call per pass
  // makes that race impossible.
  const autoSelectedScopeRef = useRef<string | null>(null);
  const autoSelectedLiteratureCountRef = useRef(0);
  useEffect(() => {
    if (!inventory.data) return;
    const scopeKey = `${deepestTaxonKey}|${region.region_gadm_id}`;
    const isNewScope = autoSelectedScopeRef.current !== scopeKey;
    const literatureGrew = literatureRecords.length > autoSelectedLiteratureCountRef.current;
    autoSelectedScopeRef.current = scopeKey;
    autoSelectedLiteratureCountRef.current = literatureRecords.length;

    const selectWholeScope = isNewScope && selected.size === 0;
    if (!selectWholeScope && !literatureGrew) return;

    const next = new Map(selected);
    for (const species of effectiveSpecies) {
      const key = discoverySpeciesKey(species.acceptedName);
      if (next.has(key)) continue;
      if (selectWholeScope || species.sources.includes("literature")) {
        next.set(key, inventorySpeciesToRow(species));
      }
    }
    onSelectionChange(next);
  }, [
    inventory.data,
    effectiveSpecies,
    deepestTaxonKey,
    region.region_gadm_id,
    literatureRecords.length,
    selected,
    onSelectionChange,
  ]);

  const families = useMemo(() => {
    const set = new Set<string>();
    for (const s of effectiveSpecies) {
      if (s.family) set.add(s.family);
    }
    return Array.from(set).sort();
  }, [effectiveSpecies]);

  function toggleSourceFilter(key: SourceKey) {
    const next = new Set(sourceFilter);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSourceFilter(next);
  }

  const visibleSpecies = useMemo(() => {
    let list = effectiveSpecies;
    if (familyFilter) list = list.filter((s) => s.family === familyFilter);
    if (sourceFilter.size > 0) list = list.filter((s) => s.sources.some((src) => sourceFilter.has(src)));
    if (selectedOnly) list = list.filter((s) => selected.has(discoverySpeciesKey(s.acceptedName)));
    if (uploadedOnly) list = list.filter((s) => uploadedNameSet.has(s.acceptedName.trim().toLowerCase()));
    if (debouncedSearchTerm.trim()) {
      const term = debouncedSearchTerm.trim().toLowerCase();
      list = list.filter(
        (s) => s.acceptedName.toLowerCase().includes(term) || s.canonicalName.toLowerCase().includes(term),
      );
    }

    if (sortMode !== "default") {
      list = [...list].sort((a, b) =>
        sortMode === "occurrence-desc"
          ? b.totalOccurrences - a.totalOccurrences
          : a.totalOccurrences - b.totalOccurrences,
      );
    }
    return list;
  }, [
    effectiveSpecies,
    familyFilter,
    sourceFilter,
    selectedOnly,
    uploadedOnly,
    uploadedNameSet,
    selected,
    debouncedSearchTerm,
    sortMode,
  ]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: visibleSpecies.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });

  function toggle(species: InventorySpecies) {
    const key = discoverySpeciesKey(species.acceptedName);
    const next = new Map(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.set(key, inventorySpeciesToRow(species));
    }
    onSelectionChange(next);
  }

  function toggleFamily(_family: string, familySpecies: InventorySpecies[]) {
    const next = new Map(selected);
    const allSelected = familySpecies.every((s) => next.has(discoverySpeciesKey(s.acceptedName)));
    for (const species of familySpecies) {
      const key = discoverySpeciesKey(species.acceptedName);
      if (allSelected) next.delete(key);
      else next.set(key, inventorySpeciesToRow(species));
    }
    onSelectionChange(next);
  }

  function toggleAll() {
    const next = new Map(selected);
    const allSelected = visibleSpecies.every((s) => next.has(discoverySpeciesKey(s.acceptedName)));
    for (const species of visibleSpecies) {
      const key = discoverySpeciesKey(species.acceptedName);
      if (allSelected) next.delete(key);
      else next.set(key, inventorySpeciesToRow(species));
    }
    onSelectionChange(next);
  }

  if (deepestTaxonKey === null) {
    return (
      <p className="text-sm text-on-surface-variant">
        Select a taxonomic scope in Step 1 to discover a species inventory for this region.
      </p>
    );
  }

  if (inventory.isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary animate-spin text-[18px]">progress_activity</span>
        <span className="font-code-md text-[12px] text-on-surface-variant">
          Discovering species inventory across all evidence sources…
        </span>
      </div>
    );
  }

  if (inventory.error) {
    return (
      <p className="text-sm text-red-600">
        Failed to build species inventory: {(inventory.error as Error).message}
      </p>
    );
  }

  // Not an assertion: `isLoading` above is the hook's promise that data has
  // arrived, and a break in that invariant should degrade to a spinner rather
  // than throw on the first field read and blank the whole step.
  if (!inventory.data) {
    return (
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary animate-spin text-[18px]">progress_activity</span>
        <span className="font-code-md text-[12px] text-on-surface-variant">
          Discovering species inventory across all evidence sources…
        </span>
      </div>
    );
  }

  const data = inventory.data;
  const allVisibleSelected =
    visibleSpecies.length > 0 && visibleSpecies.every((s) => selected.has(discoverySpeciesKey(s.acceptedName)));

  return (
    <div className="flex flex-col gap-sm">
      <div className="space-y-xs">
        <h3 className="font-headline-md text-[13px] font-bold text-on-surface">Species Inventory</h3>
        <p className="text-xs text-on-surface-variant">
          Aggregated evidence across <SourceCreditLinks sources={SOURCE_ORDER} labels={SOURCE_LABEL} />, normalized
          against the local GBIF backbone.
        </p>
      </div>

      {/* Total species count + evidence summary by source (color-coded per source) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Candidate Species" value={effectiveSpecies.length} highlight />
        {withLiteratureDateRange(data.sourceSummary, literatureRecords).map((s) => (
          <SourceStat key={s.source} summary={s} />
        ))}
        {uploadedRows.length > 0 && <StatCard label="User Uploaded" value={uploadedRows.length} />}
        <StatCard
          label="Date Range"
          value={dateRange ? `${dateRange.earliest}–${dateRange.latest}` : "—"}
          onHelpClick={() => setShowDateRangeInfo(true)}
        />
      </div>

      {showDateRangeInfo && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          onClick={() => setShowDateRangeInfo(false)}
        >
          <div
            className="bg-white border border-outline-variant rounded-sm shadow-hard w-[22rem] max-w-[90vw] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-on-surface">Date Range</h3>
              <button onClick={() => setShowDateRangeInfo(false)} className="text-on-surface-variant hover:text-primary">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              This range spans the earliest and latest observation dates among the occurrence
              records contributing to this inventory — not when this data was fetched.
            </p>
          </div>
        </div>
      )}

      <PriorChecklistBanner
        priorChecklists={data.priorChecklists}
        taxonGroup={deepestTaxonName(taxonomicScope)}
        regionName={region.region_name}
      />

      {/* Filters + view mode toggle — single compact row */}
      <div className="border border-outline-variant bg-surface px-2 py-1.5 flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search species…"
          aria-label="Search species"
          className="border border-outline-variant bg-white px-2 py-1 text-[12px] focus:border-primary focus:outline-none w-[140px]"
        />

        {families.length > 0 && (
          <select
            aria-label="Filter by family"
            className="border border-outline-variant bg-white px-1.5 py-1 text-[12px] focus:border-primary focus:outline-none"
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
          >
            <option value="">All families ({families.length})</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Sort order"
          className="border border-outline-variant bg-white px-1.5 py-1 text-[12px] focus:border-primary focus:outline-none"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
        >
          <option value="default">Default order</option>
          <option value="occurrence-desc">Highest occurrence first</option>
          <option value="occurrence-asc">Lowest occurrence first</option>
        </select>

        <div className="h-5 w-px bg-outline-variant mx-0.5" />

        <div className="flex gap-1">
          {SOURCE_ORDER.map((key) => {
            const active = sourceFilter.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSourceFilter(key)}
                className={`px-1.5 py-1 text-[10px] font-label-caps uppercase tracking-wider border transition-colors ${
                  active
                    ? "text-white border-transparent"
                    : "bg-white text-on-surface-variant border-outline-variant"
                }`}
                style={active ? { backgroundColor: SOURCE_HEX[key] } : undefined}
                title={`Filter to species with ${SOURCE_LABEL[key]} evidence`}
              >
                {SOURCE_LABEL[key]}
              </button>
            );
          })}
          {uploadedRows.length > 0 && (
            <button
              type="button"
              onClick={() => setUploadedOnly((v) => !v)}
              className={`px-1.5 py-1 text-[10px] font-label-caps uppercase tracking-wider border transition-colors ${
                uploadedOnly ? "text-white border-transparent bg-blue-700" : "bg-white text-on-surface-variant border-outline-variant"
              }`}
              title="Filter to species you uploaded"
            >
              Uploaded
            </button>
          )}
        </div>

        <label className="flex items-center gap-1 text-[12px] text-on-surface-variant cursor-pointer">
          <input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} />
          Selected only
        </label>

        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`px-2 py-1 text-[10px] font-label-caps uppercase tracking-wider border ${
              viewMode === "list" ? "bg-primary text-on-primary border-primary" : "bg-white border-outline-variant text-on-surface-variant"
            }`}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setViewMode("chart")}
            className={`px-2 py-1 text-[10px] font-label-caps uppercase tracking-wider border ${
              viewMode === "chart" ? "bg-primary text-on-primary border-primary" : "bg-white border-outline-variant text-on-surface-variant"
            }`}
          >
            Chart
          </button>
        </div>
      </div>

      {viewMode === "chart" ? (
        <InventoryChart species={visibleSpecies} selected={selected} onToggleFamily={toggleFamily} />
      ) : (
        /* Species list with source presence matrix — scrollable so the
           surrounding dialog/page never has to grow past the viewport.
           Rendered as a virtualized CSS grid (not a real <table>) since a
           plain <table>/<tbody> can't be windowed without breaking column
           alignment — this is what let 1000+ row inventories render every
           <tr> at once and freeze the tab. Only the rows in/near the
           viewport are ever mounted, regardless of inventory size. */
        <div
          ref={scrollContainerRef}
          role="table"
          aria-label="Species inventory"
          className="border border-outline-variant bg-white overflow-auto max-h-[min(55vh,520px)] text-left text-xs"
        >
          <div
            role="row"
            style={{ gridTemplateColumns: TABLE_GRID_TEMPLATE }}
            className="grid bg-surface-container-low sticky top-0 z-10 font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant"
          >
            <div role="columnheader" className="px-2 py-1.5 flex items-center">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAll}
                aria-label="Select all visible species"
              />
            </div>
            <div role="columnheader" className="px-2 py-1.5 flex items-center">
              Scientific Name
            </div>
            <div role="columnheader" className="px-2 py-1.5 flex items-center">
              Common Name
            </div>
            <div role="columnheader" className="px-2 py-1.5 flex items-center">
              Family
            </div>
            {SOURCE_ORDER.map((key) => (
              <div key={key} role="columnheader" className="px-2 py-1.5 flex items-center justify-center">
                {SOURCE_LABEL[key]}
              </div>
            ))}
            <div role="columnheader" className="px-2 py-1.5 flex items-center justify-end">
              Total Occurrences
            </div>
          </div>

          {visibleSpecies.length === 0 ? (
            <div className="px-3 py-4 text-center text-on-surface-variant">
              No species found for this scope/region/filter combination.
            </div>
          ) : (
            <div
              style={{
                position: "relative",
                height: rowVirtualizer.getTotalSize(),
                // Establishes the same total width as the header row below
                // (an ordinary grid using this exact column template also
                // overflows past the viewport, via CSS Grid's automatic
                // minimum-size rule, since every column has a fixed px
                // minimum). Without this, this wrapper has no in-flow
                // content of its own (every row inside is position:absolute,
                // so none of them count toward its auto width) and collapses
                // to the *visible* width — so each row's `width: "100%"`
                // below was only ever 100% of that narrow, pre-scroll width,
                // leaving its background/border-bottom short of the real
                // right edge while the header (sized independently) still
                // spanned the full scrollable width.
                display: "grid",
                gridTemplateColumns: TABLE_GRID_TEMPLATE,
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const species = visibleSpecies[virtualRow.index];
                const key = discoverySpeciesKey(species.acceptedName);
                const isSelected = selected.has(key);
                return (
                  <div
                    key={key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    role="row"
                    style={{
                      gridTemplateColumns: TABLE_GRID_TEMPLATE,
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={`grid border-b border-outline-variant hover:bg-surface-container-low transition-colors ${
                      species.unresolved ? "bg-amber-50" : ""
                    }`}
                  >
                    <div role="cell" className="px-2 py-1.5 flex items-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(species)}
                        aria-label={`Select ${species.acceptedName}`}
                      />
                    </div>
                    <div role="cell" className="px-2 py-1.5 flex items-center italic">
                      {species.acceptedName}
                      {uploadedNameSet.has(species.acceptedName.trim().toLowerCase()) && (
                        <span className="ml-2 font-label-caps text-[9px] uppercase tracking-wider text-blue-700">
                          uploaded
                        </span>
                      )}
                      {species.unresolved && (
                        <span className="ml-2 font-label-caps text-[9px] uppercase tracking-wider text-amber-700">
                          unresolved
                        </span>
                      )}
                    </div>
                    <div role="cell" className="px-2 py-1.5 flex items-center">
                      {species.commonName ?? "—"}
                    </div>
                    <div role="cell" className="px-2 py-1.5 flex items-center text-on-surface-variant">
                      {species.family ?? "—"}
                    </div>
                    {SOURCE_ORDER.map((sourceKey) => {
                      const count = species.occurrenceCounts[sourceKey];
                      const present = species.sources.includes(sourceKey);
                      const sourceLink =
                        sourceKey === "literature" && present ? findLiteratureLink(species.records) : null;
                      return (
                        <div
                          key={sourceKey}
                          role="cell"
                          className="px-2 py-1.5 flex items-center justify-center mono-text text-[11px]"
                        >
                          {present ? (
                            sourceLink ? (
                              <a
                                href={sourceLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary font-bold underline"
                                title="Open source document"
                              >
                                {count !== undefined ? count : "✓"}
                              </a>
                            ) : (
                              <span className="text-primary font-bold" title={`${SOURCE_LABEL[sourceKey]}: present`}>
                                {count !== undefined ? count : "✓"}
                              </span>
                            )
                          ) : (
                            <span className="text-on-surface-variant/30">—</span>
                          )}
                        </div>
                      );
                    })}
                    <div role="cell" className="px-2 py-1.5 flex items-center justify-end mono-text font-bold">
                      {species.totalOccurrences || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Scientific name of the deepest selected taxonomic rank, for display in the prior-checklist banner. */
export function deepestTaxonName(scope: TaxonomicScope): string | null {
  return deepestTaxon(scope).name;
}

/**
 * Informational banner shown when literature search detects one or more
 * documents that look like an already-published checklist/survey for this
 * taxon group + region. Does not block any wizard action.
 */
export function PriorChecklistBanner({
  priorChecklists,
  taxonGroup,
  regionName,
}: {
  priorChecklists: LiteratureDocument[];
  taxonGroup: string | null;
  regionName: string;
}) {
  if (priorChecklists.length === 0) return null;

  return (
    <div className="border border-outline-variant bg-surface px-3 py-2 flex flex-col gap-1.5 border-l-4 border-l-purple-500">
      <p className="font-body-sm text-on-surface">
        <span className="material-symbols-outlined text-purple-600 text-[16px] align-middle mr-1">menu_book</span>
        We found {priorChecklists.length} existing checklist{priorChecklists.length === 1 ? "" : "s"}
        {taxonGroup ? ` for ${taxonGroup}` : ""} in {regionName} — review before creating a duplicate.
      </p>
      <ul className="flex flex-col gap-0.5">
        {priorChecklists.map((doc) => {
          const href = doc.url ?? (doc.doi ? `https://doi.org/${doc.doi}` : null);
          return (
            <li key={doc.id} className="font-code-md text-[12px] text-on-surface-variant">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  {doc.title}
                  {doc.year ? ` (${doc.year})` : ""}
                  <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                </a>
              ) : (
                <span>
                  {doc.title}
                  {doc.year ? ` (${doc.year})` : ""}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
  onHelpClick,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
  onHelpClick?: () => void;
}) {
  return (
    <div
      className={`border border-outline-variant px-3 py-2 flex flex-col gap-0.5 ${
        highlight ? "bg-primary-container/20" : "bg-surface"
      }`}
    >
      <span className="flex items-center gap-1 font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">
        {label}
        {onHelpClick && (
          <button
            type="button"
            onClick={onHelpClick}
            aria-label={`About ${label}`}
            className="material-symbols-outlined scale-65 relative -top-0.5 text-on-surface-variant hover:text-primary normal-case tracking-normal "
          >
            help
          </button>
        )}
      </span>
      <span className="font-code-md text-[14px] font-bold text-on-surface">{value}</span>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ok: "",
  empty: "no records",
  disabled: "unavailable",
  error: "error",
};

interface SourceSummaryLike {
  source: string;
  label: string;
  status: string;
  speciesCount: number;
  totalOccurrences: number;
  occurrenceLabel: string;
  message?: string;
}

function SourceStat({ summary }: { summary: SourceSummaryLike }) {
  const statusNote = STATUS_LABEL[summary.status];
  const key = summary.source as SourceKey;
  const accent = SOURCE_ACCENT[key] ?? "";
  const tint = SOURCE_BG_TINT[key] ?? "bg-surface";
  const textColor = SOURCE_TEXT_COLOR[key] ?? "text-on-surface";
  return (
    <div className={`border border-outline-variant px-3 py-2 flex flex-col gap-0.5 ${tint} ${accent}`} title={summary.message}>
      <span className={`font-label-caps text-[9px] uppercase tracking-wider ${textColor}`}>
        {summary.label}
        {statusNote && ` · ${statusNote}`}
      </span>
      <span className="font-code-md text-[14px] font-bold text-on-surface">
        {summary.status === "disabled" || summary.status === "error" ? "—" : summary.speciesCount}
      </span>
      {summary.totalOccurrences > 0 && (
        <span className="font-code-md text-[10px] text-on-surface-variant">
          {summary.totalOccurrences} {summary.occurrenceLabel}
        </span>
      )}
    </div>
  );
}

/** A reasonably distinct, repeatable color palette for an arbitrary number of families. */
const FAMILY_PALETTE = [
  "#3b82f6", "#10b981", "#f97316", "#a855f7", "#ef4444", "#14b8a6",
  "#eab308", "#6366f1", "#ec4899", "#84cc16", "#0ea5e9", "#f59e0b",
  "#8b5cf6", "#22c55e", "#d946ef", "#64748b",
];

/** Donut chart of the visible species, broken down by family. Clicking a family row selects/deselects all of its species. */
/** Point on a circle of radius `r` centered at (cx,cy), at `angleDeg` clockwise from the top — matches CSS conic-gradient's own angle convention. */
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path for one pie slice spanning [startAngle, endAngle) (degrees, clockwise from top). */
function describePieSlice(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function InventoryChart({
  species,
  selected,
  onToggleFamily,
}: {
  species: InventorySpecies[];
  selected: Map<string, ParsedSpeciesRow>;
  onToggleFamily: (family: string, familySpecies: InventorySpecies[]) => void;
}) {
  // The family shown below the chart — set on hover, but deliberately never
  // cleared back to null on mouse-leave (only ever replaced by hovering/
  // clicking a *different* slice or table row), so the info line doesn't
  // vanish the moment the pointer leaves the slice.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Whether the active family's genus subdivision list is expanded — toggled
  // by clicking the info line itself, independent of which family is active.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const segments = useMemo(() => {
    const groups = new Map<string, InventorySpecies[]>();
    for (const s of species) {
      const family = s.family ?? "Unclassified";
      const arr = groups.get(family) ?? [];
      arr.push(s);
      groups.set(family, arr);
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([label, list], i) => ({
        key: label,
        label,
        value: list.length,
        species: list,
        color: FAMILY_PALETTE[i % FAMILY_PALETTE.length],
      }));
  }, [species]);

  const total = species.length;

  if (total === 0 || segments.length === 0) {
    return (
      <div className="border border-outline-variant bg-white px-3 py-8 text-center text-sm text-on-surface-variant">
        No species to chart for this filter combination.
      </div>
    );
  }

  const arcs = segments.reduce<{ parts: { seg: (typeof segments)[number]; start: number; end: number }[]; cumulative: number }>(
    (acc, seg) => {
      const start = (acc.cumulative / total) * 360;
      const cumulative = acc.cumulative + seg.value;
      const end = (cumulative / total) * 360;
      return { parts: [...acc.parts, { seg, start, end }], cumulative };
    },
    { parts: [], cumulative: 0 },
  ).parts;

  const displaySeg = activeKey ? segments.find((s) => s.key === activeKey) ?? null : null;

  function toggleExpanded(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  /** Species in this family grouped by genus, for the subdivision list. */
  function genusBreakdown(familySpecies: InventorySpecies[]): { genus: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const s of familySpecies) {
      const genus = s.classification.genus ?? "Unclassified";
      counts.set(genus, (counts.get(genus) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([genus, count]) => ({ genus, count }));
  }

  // Hover feedback is purely a translation — the hovered slice's own arc
  // (start/end angles, radius) never changes, so its shape stays identical;
  // it just shifts outward along its own mid-angle direction, which opens a
  // small gap on either side of it as a side effect of moving away from its
  // neighbors rather than from resizing itself. No dimming/recoloring of the
  // rest either, so every slice keeps its assigned color at all times.
  const POP_DISTANCE = 8;
  const CENTER = 100;
  // Leaves margin inside the 200x200 viewBox for POP_DISTANCE: at RADIUS=100
  // the circle exactly touches every edge, so popping a slice outward pushed
  // part of its arc past the SVG viewport's boundary and got clipped —
  // visible as a flattened/cut edge, and most noticeable on big slices since
  // they sweep across more of that boundary.
  const RADIUS = 100 - POP_DISTANCE - 4;

  return (
    <div className="border border-outline-variant bg-white p-md flex flex-col sm:flex-row items-start gap-lg">
      <div className="flex flex-col items-center gap-2 shrink-0 mx-auto sm:mx-0 w-[200px]">
        <div className="relative w-[200px] h-[200px] shrink-0">
          <svg
            viewBox="0 0 200 200"
            className="w-full h-full overflow-visible"
            role="img"
            aria-label="Species count by family"
          >
            {/* Active slice's path is rendered last (SVG stacks purely by
                document order, no z-index) so its outward pop-out never
                gets covered by a later neighbor. */}
            {[...arcs]
              .sort((a, b) => (a.seg.key === activeKey ? 1 : 0) - (b.seg.key === activeKey ? 1 : 0))
              .map(({ seg, start, end }) => {
                const isActive = activeKey === seg.key;
                const midRad = ((start + end) / 2 - 90) * (Math.PI / 180);
                const offset = isActive ? POP_DISTANCE : 0;
                const dx = Math.cos(midRad) * offset;
                const dy = Math.sin(midRad) * offset;
                return (
                  <path
                    key={seg.key}
                    d={describePieSlice(CENTER, CENTER, RADIUS, start, end)}
                    fill={seg.color}
                    stroke="white"
                    strokeWidth={1}
                    style={{ transform: `translate(${dx}px, ${dy}px)`, transition: "transform 150ms ease" }}
                    className="cursor-pointer"
                    onMouseEnter={() => setActiveKey(seg.key)}
                    onClick={() => setActiveKey(seg.key)}
                  />
                );
              })}
          </svg>
        </div>
        <p className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant/70">
          {total} species total
        </p>

        {displaySeg && (
          <div className="w-full text-xs">
            <button
              type="button"
              onClick={() => toggleExpanded(displaySeg.key)}
              className="w-full flex items-center justify-center gap-1 hover:text-primary transition-colors"
            >
              <span className="w-2.5 h-2.5 inline-block rounded-sm shrink-0" style={{ backgroundColor: displaySeg.color }} />
              <span className="font-bold text-on-surface">{displaySeg.label}</span>
              <span className="text-on-surface-variant">{Math.round((displaySeg.value / total) * 100)}%</span>
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">
                {expandedKey === displaySeg.key ? "expand_less" : "expand_more"}
              </span>
            </button>

            {expandedKey === displaySeg.key && (
              <div className="mt-1.5 border border-outline-variant bg-surface-container-low max-h-32 overflow-y-auto divide-y divide-outline-variant/50">
                {genusBreakdown(displaySeg.species).map(({ genus, count }) => (
                  <div key={genus} className="flex items-center justify-between px-2 py-1">
                    <span className="italic text-on-surface-variant">{genus}</span>
                    <span className="mono-text text-on-surface">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Family breakdown table — scrollable so a long family list doesn't push the chart out of view. */}
      <div className="flex-1 w-full border border-outline-variant max-h-[320px] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-container-low sticky top-0">
            <tr className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant">
              <th className="pl-2 pr-0.5 py-1.5"></th>
              <th className="px-0.5 py-1.5"></th>
              <th className="pl-1 pr-3 py-1.5">Family</th>
              <th className="px-3 py-1.5 text-right">Species</th>
              <th className="px-3 py-1.5 text-right">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {segments.map((seg) => {
              const selectedCount = seg.species.filter((s) => selected.has(discoverySpeciesKey(s.acceptedName))).length;
              const allSelected = selectedCount === seg.species.length;
              const someSelected = selectedCount > 0 && !allSelected;
              return (
                <tr
                  key={seg.key}
                  className={`cursor-pointer transition-colors ${
                    activeKey === seg.key ? "bg-surface-container-low" : "hover:bg-surface-container-low"
                  }`}
                  onClick={() => onToggleFamily(seg.label, seg.species)}
                  onMouseEnter={() => setActiveKey(seg.key)}
                  title={`Click to ${allSelected ? "deselect" : "select"} all ${seg.label} species`}
                >
                  <td className="pl-2 pr-0.5 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={() => onToggleFamily(seg.label, seg.species)}
                      aria-label={`Select all ${seg.label} species`}
                      className="scale-75"
                    />
                  </td>
                  <td className="px-0.5 py-1.5">
                    <span className="w-2 h-2 inline-block rounded-sm" style={{ backgroundColor: seg.color }} />
                  </td>
                  <td className="pl-1 pr-3 py-1.5">{seg.label}</td>
                  <td className="px-3 py-1.5 text-right mono-text">{seg.value}</td>
                  <td className="px-3 py-1.5 text-right mono-text text-on-surface-variant">
                    {Math.round((seg.value / total) * 100)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
