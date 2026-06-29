"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TaxonomicScope } from "@/types/checklist.types";
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
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [sourceFilter, setSourceFilter] = useState<Set<SourceKey>>(new Set());
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [uploadedOnly, setUploadedOnly] = useState(false);
  const inventory = useSpeciesInventory(taxonomicScope, deepestTaxonKey, region, enabledSources, literatureRecords);

  // The filter button only renders while there are uploaded rows — reset it
  // so the filter doesn't stay silently active once that button disappears.
  useEffect(() => {
    if (uploadedRows.length === 0) setUploadedOnly(false);
  }, [uploadedRows.length]);

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
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
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
  }, [effectiveSpecies, familyFilter, sourceFilter, selectedOnly, uploadedOnly, uploadedNameSet, selected, searchTerm, sortMode]);

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

  const data = inventory.data!;
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
        <StatCard label="Date Range" value={dateRange ? `${dateRange.earliest}–${dateRange.latest}` : "—"} />
      </div>

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
           surrounding dialog/page never has to grow past the viewport. */
        <div className="border border-outline-variant bg-white overflow-auto max-h-[min(55vh,520px)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-container-low sticky top-0 z-10">
              <tr className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant">
                <th className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="Select all visible species"
                  />
                </th>
                <th className="px-2 py-1.5">Scientific Name</th>
                <th className="px-2 py-1.5">Common Name</th>
                <th className="px-2 py-1.5">Family</th>
                {SOURCE_ORDER.map((key) => (
                  <th key={key} className="px-2 py-1.5 text-center">
                    {SOURCE_LABEL[key]}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right">Total Occurrences</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {visibleSpecies.map((species) => {
                const key = discoverySpeciesKey(species.acceptedName);
                const isSelected = selected.has(key);
                return (
                  <tr
                    key={key}
                    className={`hover:bg-surface-container-low transition-colors ${
                      species.unresolved ? "bg-amber-50" : ""
                    }`}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(species)}
                        aria-label={`Select ${species.acceptedName}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 italic">
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
                    </td>
                    <td className="px-2 py-1.5">{species.commonName ?? "—"}</td>
                    <td className="px-2 py-1.5 text-on-surface-variant">{species.family ?? "—"}</td>
                    {SOURCE_ORDER.map((sourceKey) => {
                      const count = species.occurrenceCounts[sourceKey];
                      const present = species.sources.includes(sourceKey);
                      const sourceLink =
                        sourceKey === "literature" && present ? findLiteratureLink(species.records) : null;
                      return (
                        <td key={sourceKey} className="px-2 py-1.5 text-center mono-text text-[11px]">
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
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right mono-text font-bold">{species.totalOccurrences || "—"}</td>
                  </tr>
                );
              })}
              {visibleSpecies.length === 0 && (
                <tr>
                  <td colSpan={SOURCE_ORDER.length + 5} className="px-3 py-4 text-center text-on-surface-variant">
                    No species found for this scope/region/filter combination.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const SCOPE_RANKS = ["kingdom", "phylum", "class", "order", "family", "genus", "species"] as const;

/** Scientific name of the deepest selected taxonomic rank, for display in the prior-checklist banner. */
export function deepestTaxonName(scope: TaxonomicScope): string | null {
  for (let i = SCOPE_RANKS.length - 1; i >= 0; i -= 1) {
    const value = scope[SCOPE_RANKS[i]];
    if (value) return value;
  }
  return null;
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

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div
      className={`border border-outline-variant px-3 py-2 flex flex-col gap-0.5 ${
        highlight ? "bg-primary-container/20" : "bg-surface"
      }`}
    >
      <span className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">{label}</span>
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
function InventoryChart({
  species,
  selected,
  onToggleFamily,
}: {
  species: InventorySpecies[];
  selected: Map<string, ParsedSpeciesRow>;
  onToggleFamily: (family: string, familySpecies: InventorySpecies[]) => void;
}) {
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

  const gradientParts = segments.reduce<{ parts: string[]; cumulative: number }>(
    (acc, seg) => {
      const start = (acc.cumulative / total) * 360;
      const cumulative = acc.cumulative + seg.value;
      const end = (cumulative / total) * 360;
      return { parts: [...acc.parts, `${seg.color} ${start}deg ${end}deg`], cumulative };
    },
    { parts: [], cumulative: 0 },
  ).parts;

  return (
    <div className="border border-outline-variant bg-white p-md flex flex-col sm:flex-row items-start gap-lg">
      <div className="flex flex-col items-center gap-2 shrink-0 mx-auto sm:mx-0">
        <div
          className="w-[160px] h-[160px] rounded-full shrink-0"
          style={{ background: `conic-gradient(${gradientParts.join(", ")})` }}
          role="img"
          aria-label="Species count by family"
        />
        <p className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant/70">
          {total} species total
        </p>
      </div>

      {/* Family breakdown table — scrollable so a long family list doesn't push the chart out of view. */}
      <div className="flex-1 w-full border border-outline-variant max-h-[320px] overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-container-low sticky top-0">
            <tr className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant">
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Family</th>
              <th className="px-3 py-2 text-right">Species</th>
              <th className="px-3 py-2 text-right">Share</th>
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
                  className="cursor-pointer hover:bg-surface-container-low transition-colors"
                  onClick={() => onToggleFamily(seg.label, seg.species)}
                  title={`Click to ${allSelected ? "deselect" : "select"} all ${seg.label} species`}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={() => onToggleFamily(seg.label, seg.species)}
                      aria-label={`Select all ${seg.label} species`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="w-3 h-3 inline-block rounded-sm" style={{ backgroundColor: seg.color }} />
                  </td>
                  <td className="px-3 py-2 font-bold">{seg.label}</td>
                  <td className="px-3 py-2 text-right mono-text">{seg.value}</td>
                  <td className="px-3 py-2 text-right mono-text text-on-surface-variant">
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
