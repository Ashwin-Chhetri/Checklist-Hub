"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Species } from "@/types/species.types";
import { useSpeciesMedia } from "@/modules/taxonomy/hooks/useSpeciesMedia";
import { useEnrichTaxonomy } from "@/modules/taxonomy/hooks/useEnrichTaxonomy";
import { useTaxonomySuggest, type TaxonomySuggestion } from "@/modules/taxonomy/hooks/useTaxonomySuggest";
import { useSpeciesList } from "@/modules/species/hooks/useSpecies";
import { sortConflictsGbifFirst } from "@/modules/taxonomy/utils/sortConflicts";

interface TaxonomyPanelProps {
  species: Species;
  checklistId: string;
  /** Scientific name of the active secondary tab — the species' own (imported)
   * name, or a conflict/synonym option's suggested name. The tab bar itself
   * lives in SpeciesPanel, directly under the main Taxonomy/Evidence/Discussion
   * tabs, so the active tab is controlled from there. */
  activeDetailTab?: string;
}

const CLASSIFICATION_RANKS: { key: string; label: string }[] = [
  { key: "kingdom", label: "Kingdom" },
  { key: "phylum", label: "Phylum" },
  { key: "class", label: "Class" },
  { key: "order", label: "Order" },
  { key: "family", label: "Family" },
  { key: "genus", label: "Genus" },
  { key: "species", label: "Species" },
];

type ClassificationFields = Record<string, string>;
type RankValues = Record<string, string | null | undefined>;

interface TaxonomyOption {
  name: string;
  taxonId: number | null;
  authorship: string | null;
  year: number | null;
  classification: RankValues | null;
}

export default function TaxonomyPanel({ species, checklistId, activeDetailTab }: TaxonomyPanelProps) {
  const queryClient = useQueryClient();
  // Read straight off the `species` prop — it's already kept fresh by the
  // species list query (and by useEnrichTaxonomy's invalidation below).
  // Previously this panel ran its OWN separate fetch for the same data
  // (useTaxonomyPanel → a second "species detail" query), which could lag
  // behind the list: the row would show freshly-enriched data while this
  // panel's conflict/synonym option tabs kept showing the pre-enrichment
  // snapshot from whenever that second query last ran.
  const taxonomy = species.taxonomy;
  const { data: mediaItems = [] } = useSpeciesMedia(species.gbif_taxon_key);

  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState({
    scientific_name: "",
    common_name: "",
    gbif_taxon_key: "",
  });
  const [editClassification, setEditClassification] = useState<ClassificationFields>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data: allSpecies } = useSpeciesList(checklistId);

  // Backbone type-ahead for the scientific name field — debounced so we don't
  // fire a query on every keystroke, and suppressed once the user has picked
  // a suggestion (re-armed if they go on to edit the name further).
  const [nameQuery, setNameQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: suggestions = [] } = useTaxonomySuggest(nameQuery);

  function handleNameInputChange(value: string) {
    setEditFields((f) => ({ ...f, scientific_name: value }));
    setShowSuggestions(true);
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    suggestDebounceRef.current = setTimeout(() => setNameQuery(value), 250);
  }

  function applySuggestion(s: TaxonomySuggestion) {
    setEditFields((f) => ({
      ...f,
      scientific_name: s.canonicalName ?? s.scientificName ?? f.scientific_name,
      common_name: s.commonName ?? f.common_name,
      gbif_taxon_key: String(s.taxonId),
    }));
    setEditClassification((c) => ({
      ...c,
      kingdom: s.classification.kingdom ?? c.kingdom ?? "",
      phylum: s.classification.phylum ?? c.phylum ?? "",
      class: s.classification.class ?? c.class ?? "",
      order: s.classification.order ?? c.order ?? "",
      family: s.classification.family ?? c.family ?? "",
      genus: s.classification.genus ?? c.genus ?? "",
      species: s.classification.species ?? c.species ?? "",
    }));
    setShowSuggestions(false);
    setNameQuery("");
  }

  // While editing, detect whether the in-progress field values would collide
  // with another active row in this checklist — used purely to relabel the
  // submit button ("Merge" vs "Save Changes") before the user commits; the
  // PATCH route re-checks this server-side and is the actual source of truth.
  const pendingDuplicate = useMemo(() => {
    if (!editMode || !allSpecies) return null;
    const key = editFields.gbif_taxon_key.trim() ? Number(editFields.gbif_taxon_key.trim()) : null;
    const name = editFields.scientific_name.trim().toLowerCase();
    return (
      allSpecies.find((s) => {
        if (s.id === species.id || s.is_active === false) return false;
        if (key) return s.gbif_taxon_key === key;
        return name.length > 0 && s.scientific_name.trim().toLowerCase() === name;
      }) ?? null
    );
  }, [editMode, allSpecies, editFields, species.id]);

  // Merged field-by-field rather than `taxonomy?.classification ?? {fallback}` —
  // stored classification objects commonly have kingdom..genus but no `species`
  // key (older data predates that field), so an object-level fallback would
  // never kick in and "species" would render permanently empty.
  const ownClassification: RankValues = {
    kingdom: taxonomy?.classification?.kingdom ?? species.kingdom ?? null,
    phylum: taxonomy?.classification?.phylum ?? species.phylum ?? null,
    class: taxonomy?.classification?.class ?? species.class ?? null,
    order: taxonomy?.classification?.order ?? species.order ?? null,
    family: taxonomy?.classification?.family ?? species.family ?? null,
    genus: taxonomy?.classification?.genus ?? species.genus ?? null,
    species: taxonomy?.classification?.species ?? species.scientific_name ?? null,
  };
  const synonyms = taxonomy?.synonyms ?? [];
  // GBIF-sourced suggestion first, any other-source (e.g. within-batch
  // common-name heuristic) suggestion second, so the secondary tab bar always
  // orders the authoritative option ahead of weaker-evidence ones.
  const conflicts = sortConflictsGbifFirst(taxonomy?.authority_conflicts ?? []);

  // Fallback fetcher: if ingestion still left this row's own hierarchy/
  // authority OR any conflict/synonym OPTION's hierarchy incomplete, ask the
  // server to try every identifying string available (own/imported name,
  // recorded synonym/conflict names, every known common name) against the
  // backbone, once, and persist whatever it finds — never a per-render live
  // lookup. Guarded so it fires at most once per species per panel session,
  // including for genuinely-unresolvable rows. Checking every option (not
  // just the row's own) matters because a row can have its own hierarchy
  // complete while a specific conflict/synonym entry is still missing one —
  // ingestion already tries hard to fill every entry (see Pass 7 in
  // buildSpeciesPayload.server.ts), this is just the safety net for whatever
  // it still misses.
  // Year is excluded here — it's frequently genuinely absent from the backbone
  // for a given name (a real data limitation, not a fixable gap), so requiring
  // it would make this fire on nearly every species and waste a network round
  // trip for nothing.
  const isMissingHierarchy = (classification: unknown) =>
    !Object.values((classification ?? {}) as Record<string, unknown>).some((v) => Boolean(v));
  // Conflict entries' `authority` is always a source/provenance label (e.g.
  // "GBIF Backbone") — only `authorship` is the real taxonomic authorship, so
  // checking `authority` here would always be truthy and mask a real gap.
  const conflictIncomplete = (c: { classification?: unknown; authorship?: string | null }) =>
    isMissingHierarchy(c.classification) || !c.authorship;
  // Synonym entries use `authority` for the real taxonomic authorship EXCEPT
  // for event_type "source_synonym", where it's intentionally just a source
  // label that may never get a real one — don't keep retrying those forever.
  const synonymIncomplete = (s: { event_type?: string; classification?: unknown; authority?: string | null }) =>
    isMissingHierarchy(s.classification) || (s.event_type !== "source_synonym" && !s.authority);
  const enrichTaxonomy = useEnrichTaxonomy(checklistId, species.id);
  const enrichAttemptedFor = useRef<string | null>(null);
  const ownHierarchyIncomplete =
    !taxonomy?.authorship ||
    isMissingHierarchy(ownClassification) ||
    conflicts.some(conflictIncomplete) ||
    synonyms.some(synonymIncomplete);
  useEffect(() => {
    if (!ownHierarchyIncomplete) return;
    if (enrichAttemptedFor.current === species.id) return;
    enrichAttemptedFor.current = species.id;
    enrichTaxonomy.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [species.id, ownHierarchyIncomplete]);

  // Every scientific name this species could be filed under — its own (imported)
  // name, plus every authority-conflict and synonym option — is a first-class
  // taxon, selectable from the secondary tab bar in SpeciesPanel. Deduped by
  // name (first occurrence wins) since the same name can appear in both lists.
  const rawOptions: TaxonomyOption[] = [
    {
      name: species.scientific_name,
      taxonId: species.gbif_taxon_key ?? null,
      // species.taxonomy.authorship/name_published_in_year are captured once at
      // ingestion for the row's resolved current name — fall back to the legacy
      // imported-name authorship field for older rows that predate that capture.
      authorship:
        taxonomy?.authorship ??
        (species.identity?.scientific_name_authorship
          ? String(species.identity.scientific_name_authorship)
          : null),
      year: taxonomy?.name_published_in_year ?? null,
      classification: ownClassification,
    },
    ...conflicts.map((c) => ({
      name: c.suggested_name,
      taxonId: c.taxon_id ?? null,
      authorship: c.authorship ?? null,
      year: c.year ?? null,
      classification: (c.classification as RankValues | null | undefined) ?? null,
    })),
    ...synonyms.map((s) => ({
      name: s.name,
      taxonId: s.taxon_id ?? null,
      // s.authority is only real taxonomic authorship for event_type "synonym" —
      // for "source_synonym" it's deliberately a provenance source label (e.g.
      // "GBIF"/"eBird"), which would otherwise display here as if it were
      // authorship.
      authorship: s.event_type !== "source_synonym" ? s.authority ?? null : null,
      year: s.year ?? null,
      classification: (s.classification as RankValues | null | undefined) ?? null,
    })),
  ];
  const options = rawOptions.filter((opt, idx) => rawOptions.findIndex((o) => o.name === opt.name) === idx);
  const activeOption = options.find((o) => o.name === activeDetailTab) ?? options[0];

  // Every option (own name, each conflict, each synonym) already carries its own
  // authorship/year/classification/taxon_id, captured once at ingestion — no live
  // backbone re-lookup needed to switch tabs.
  const activeTaxonId = activeOption.taxonId ?? null;
  const activeAuthority = activeOption.authorship ?? null;
  const activeYear = activeOption.year ?? null;
  const genusFromName = activeOption.name.split(" ")[0] || null;
  const activeClassification: RankValues = {
    kingdom: activeOption.classification?.kingdom ?? null,
    phylum: activeOption.classification?.phylum ?? null,
    class: activeOption.classification?.class ?? null,
    order: activeOption.classification?.order ?? null,
    family: activeOption.classification?.family ?? null,
    genus: activeOption.classification?.genus ?? genusFromName,
    species: activeOption.classification?.species ?? activeOption.name,
  };

  function formatLicense(license: string | undefined): string {
    if (!license) return "";
    const m = license.match(/creativecommons\.org\/licenses\/([^/]+)\/([^/]+)/i);
    if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
    return license;
  }

  function openEdit() {
    setEditFields({
      scientific_name: species.scientific_name ?? "",
      common_name: species.common_name ?? "",
      gbif_taxon_key: species.gbif_taxon_key ? String(species.gbif_taxon_key) : "",
    });
    const initCls: ClassificationFields = {};
    for (const { key } of CLASSIFICATION_RANKS) {
      initCls[key] = ownClassification[key] ?? "";
    }
    setEditClassification(initCls);
    setSaveError(null);
    setMergeNotice(null);
    setShowSuggestions(false);
    setNameQuery("");
    setEditMode(true);
  }

  const [mergeNotice, setMergeNotice] = useState<string | null>(null);

  async function saveEdit() {
    setSaving(true);
    setSaveError(null);
    setMergeNotice(null);
    try {
      const classificationFields: Record<string, string | null> = {};
      for (const { key } of CLASSIFICATION_RANKS) {
        classificationFields[key] = editClassification[key]?.trim() || null;
      }
      const body: Record<string, unknown> = {
        scientific_name: editFields.scientific_name.trim() || null,
        common_name: editFields.common_name.trim() || null,
        gbif_taxon_key: editFields.gbif_taxon_key.trim()
          ? Number(editFields.gbif_taxon_key.trim())
          : null,
        classification: classificationFields,
      };
      // Direct species columns exist for every rank except "species" itself
      // (that rank IS scientific_name, already sent above).
      for (const { key } of CLASSIFICATION_RANKS) {
        if (key !== "species") body[key] = classificationFields[key];
      }
      const res = await fetch(`/api/checklists/${checklistId}/species/${species.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError((err as { error?: string }).error ?? "Save failed");
        return;
      }
      const result = (await res.json()) as { merged?: boolean };
      await queryClient.invalidateQueries({ queryKey: ["species", "list", checklistId] });
      if (result.merged) {
        setMergeNotice("Merged with an existing duplicate row — evidence and metadata combined.");
      }
      setEditMode(false);
    } catch {
      setSaveError("Network error — changes not saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">

      {/* Species image gallery */}
      {mediaItems.length > 0 && (
        <section>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {mediaItems.map((item, idx) => (
              <div key={idx} className="flex-none w-36">
                <img
                  src={item.url}
                  alt={species.scientific_name}
                  className="w-36 h-28 object-cover rounded-sm border border-surface-dim bg-surface-container-low"
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
                <p className="mt-0.5 text-[8px] text-slate-400 leading-tight truncate">
                  {item.creator ?? "Unknown"}{item.license ? ` · ${formatLicense(item.license)}` : ""} · <span className="text-brand">GBIF</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        {/* Edit form */}
        {editMode && (
          <div className="mb-4 p-3 border border-surface-dim bg-surface-container-low/50 rounded-sm space-y-3">
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold mono-text">Edit Taxonomy</p>

            {/* Core name fields */}
            <div className="space-y-2">
              <label className="block relative">
                <span className="text-[8px] text-slate-400 uppercase tracking-widest font-bold mono-text">Scientific Name</span>
                <input
                  type="text"
                  className="mt-0.5 w-full px-2 py-1.5 border border-surface-dim rounded-sm mono-text text-xs italic bg-white focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
                  value={editFields.scientific_name}
                  onChange={(e) => handleNameInputChange(e.target.value)}
                  onFocus={() => { if (editFields.scientific_name.trim().length >= 2) setShowSuggestions(true); }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="e.g. Ardea cinerea"
                  autoComplete="off"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full mt-1 z-10 max-h-64 overflow-y-auto border border-surface-dim bg-white rounded-sm shadow-hard">
                    {suggestions.map((s) => (
                      <li key={s.taxonId}>
                        <button
                          type="button"
                          className="w-full text-left px-2 py-1.5 hover:bg-surface-container-low border-b border-surface-dim/60 last:border-b-0"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applySuggestion(s)}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="mono-text text-xs italic font-bold">
                              {s.canonicalName ?? s.scientificName}
                              {s.authorship && (
                                <span className="not-italic font-normal text-slate-400">
                                  {" "}({[s.authorship, s.year ? String(s.year) : null].filter(Boolean).join(", ")})
                                </span>
                              )}
                            </span>
                            <span className="text-[8px] text-slate-400 flex-none">{s.taxonId}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <span className="text-[10px] text-slate-500 truncate">{s.commonName ?? "—"}</span>
                            <span className="text-[8px] text-slate-400 uppercase tracking-wider flex-none">
                              {s.classification.family ?? "—"}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </label>
              <label className="block">
                <span className="text-[8px] text-slate-400 uppercase tracking-widest font-bold mono-text">Common Name</span>
                <input
                  type="text"
                  className="mt-0.5 w-full px-2 py-1.5 border border-surface-dim rounded-sm text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
                  value={editFields.common_name}
                  onChange={(e) => setEditFields((f) => ({ ...f, common_name: e.target.value }))}
                  placeholder="e.g. Grey Heron"
                />
              </label>
              <label className="block">
                <span className="text-[8px] text-slate-400 uppercase tracking-widest font-bold mono-text">GBIF Taxon Key</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-0.5 w-full px-2 py-1.5 border border-surface-dim rounded-sm mono-text text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
                  value={editFields.gbif_taxon_key}
                  onChange={(e) => setEditFields((f) => ({ ...f, gbif_taxon_key: e.target.value.replace(/\D/g, "") }))}
                  placeholder="e.g. 2480855"
                />
              </label>
            </div>

            {/* Classification hierarchy */}
            <div>
              <p className="text-[8px] text-slate-400 uppercase tracking-widest font-bold mono-text mb-2">Classification Hierarchy</p>
              <div className="space-y-1.5">
                {CLASSIFICATION_RANKS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-400 uppercase tracking-widest w-14 flex-none">{label}</span>
                    <input
                      type="text"
                      className="flex-1 px-2 py-1 border border-surface-dim rounded-sm mono-text text-xs italic bg-white focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
                      value={editClassification[key] ?? ""}
                      onChange={(e) =>
                        setEditClassification((c) => ({ ...c, [key]: e.target.value }))
                      }
                      placeholder={`Enter ${label.toLowerCase()}…`}
                    />
                  </label>
                ))}
              </div>
            </div>

            {pendingDuplicate && (
              <p className="text-[9px] text-amber-700 mono-text bg-amber-50 border border-amber-200 rounded-sm px-2 py-1.5">
                A row for &quot;{pendingDuplicate.scientific_name}&quot; already exists in this checklist — saving
                will merge its evidence and metadata into this row instead of creating a duplicate.
              </p>
            )}
            {saveError && <p className="text-[10px] text-red-600 mono-text">{saveError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                className="flex-1 py-1.5 bg-brand text-white text-[9px] font-bold uppercase mono-text rounded-sm hover:bg-brand/90 disabled:opacity-50 transition-colors shadow-hard"
                disabled={saving}
                onClick={saveEdit}
              >
                {saving ? "Saving…" : pendingDuplicate ? "Merge" : "Save Changes"}
              </button>
              <button
                className="py-1.5 px-3 border border-outline-variant text-on-surface-variant text-[9px] font-bold uppercase mono-text rounded-sm hover:bg-surface-container-low transition-colors"
                disabled={saving}
                onClick={() => setEditMode(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Taxon info block (read-only) — Taxon ID, name, authority and common
            name all switch with the active scientific name tab; the rest is
            fixed metadata about the original import. */}
        {!editMode && (
          <>
            {mergeNotice && (
              <p className="mb-3 text-[9px] text-emerald-700 mono-text bg-emerald-50 border border-emerald-200 rounded-sm px-2 py-1.5">
                {mergeNotice}
              </p>
            )}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center">
                <span className="material-symbols-outlined text-slate-500 scale-75">info</span>
                <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
                  Taxon Info
                </h3>
              </div>
              {/* Small inline edit button matching theme */}
              <button
                title="Edit taxonomy fields"
                className="flex-none flex items-center gap-0.5 text-[9px] font-bold mono-text uppercase text-slate-400 hover:text-brand transition-colors"
                onClick={openEdit}
              >
                <span className="material-symbols-outlined scale-75">edit</span>
                Edit
              </button>
            </div>
            <div className="mb-4 p-2 border border-surface-dim bg-surface-container-low/50 mono-text text-[10px] space-y-1.5">
            {activeTaxonId && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-400 uppercase tracking-widest text-[8px]">Taxon ID</span>
                  <a
                    href={`https://www.gbif.org/species/${activeTaxonId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-bold text-brand hover:underline"
                  >
                    {activeTaxonId}
                  </a>
                </div>
                <div className="h-px bg-surface-dim my-1" />
              </>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400 uppercase tracking-widest text-[8px]">Scientific Name</span>
              <span className="italic font-bold">{activeOption.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 uppercase tracking-widest text-[8px]">Common Name</span>
              <span>{species.common_name ?? species.identity?.imported_common_name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 uppercase tracking-widest text-[8px]">Authority, Year</span>
              <span>{[activeAuthority, activeYear ? String(activeYear) : null].filter(Boolean).join(", ") || "—"}</span>
            </div>
            <div className="h-px bg-surface-dim my-1" />
            <div className="flex justify-between">
              <span className="text-slate-400 uppercase tracking-widest text-[8px]">Imported Name</span>
              <span className="italic">{taxonomy?.imported_name ?? species.scientific_name}</span>
            </div>
            {taxonomy?.suggested_name && (
              <div className="flex justify-between">
                <span className="text-slate-400 uppercase tracking-widest text-[8px]">Suggested Name</span>
                <span className="italic">{taxonomy.suggested_name}</span>
              </div>
            )}
            {taxonomy?.gbif_name && (
              <div className="flex justify-between">
                <span className="text-slate-400 uppercase tracking-widest text-[8px]">GBIF Taxonomic Backbone</span>
                <span className="italic">{taxonomy.gbif_name}</span>
              </div>
            )}
            {taxonomy?.catalog_of_life_name && (
              <div className="flex justify-between">
                <span className="text-slate-400 uppercase tracking-widest text-[8px]">Catalog of Life</span>
                <span className="italic">{taxonomy.catalog_of_life_name}</span>
              </div>
            )}
          </div>
          </>
        )}

        {/* Classification Hierarchy (read-only) — switches with whichever
            scientific name tab is active, from data stored at ingestion. */}
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-slate-500 scale-75">account_tree</span>
          <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
            Classification Hierarchy
          </h3>
        </div>
        <div className="relative pl-4 space-y-2 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-px before:bg-surface-dim">
          {CLASSIFICATION_RANKS.map(({ key, label }) => (
            <div key={key} className="relative flex items-center gap-2">
              <div className="absolute -left-4 w-4 h-px bg-surface-dim" />
              <span className="text-[9px] text-slate-400 uppercase tracking-widest w-16">{label}</span>
              <span className={`mono-text text-xs font-bold ${key === "species" ? "italic text-brand" : ""}`}>
                {activeClassification[key] ?? "—"}
              </span>
            </div>
          ))}
          {/* Authority, Year — same stored data as the ranks above, on the right */}
          <div className="relative flex items-center gap-2">
            <div className="absolute -left-4 w-4 h-px bg-surface-dim" />
            <span className="text-[9px] text-slate-400 uppercase tracking-widest w-16">Authority</span>
            <span className="mono-text text-xs font-bold">
              {[activeAuthority, activeYear ? String(activeYear) : null].filter(Boolean).join(", ") || "—"}
            </span>
          </div>
        </div>

      </section>
      {/* Taxonomic History */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-slate-500 scale-75">history_edu</span>
          <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
            Taxonomic History
          </h3>
        </div>
        <div className="space-y-2">
          {species.taxonomy_status === "accepted" && (
            <div className="p-2 border border-green-200 bg-green-50 rounded-sm flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[8px] text-green-700 font-bold uppercase tracking-widest">Taxonomy Clean</span>
                <span className="mono-text text-[10px] text-slate-600">Verified by GBIF Backbone</span>
              </div>
              <span className="material-symbols-outlined text-green-600 scale-75">check_circle</span>
            </div>
          )}
          {species.taxonomy_status === "synonym" && (
            <div className="p-2 border border-amber-200 bg-amber-50 rounded-sm flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[8px] text-amber-700 font-bold uppercase tracking-widest">Outdated Name</span>
                <span className="mono-text text-[10px] text-slate-600">
                  {taxonomy?.imported_name ?? species.scientific_name} → {taxonomy?.accepted_name ?? taxonomy?.current_name ?? "—"}
                </span>
              </div>
              <span className="material-symbols-outlined text-amber-500 scale-75">refresh</span>
            </div>
          )}
          {species.taxonomy_status === "authority_conflict" && (
            <div className="p-2 border border-red-200 bg-red-50 rounded-sm flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[8px] text-red-700 font-bold uppercase tracking-widest">Authority Conflict</span>
                <span className="mono-text text-[10px] text-slate-600">
                  {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""} pending review
                </span>
              </div>
              <span className="material-symbols-outlined text-red-600 scale-75">error</span>
            </div>
          )}
          {species.taxonomy_status === "unresolved" && (
            <div className="p-2 border border-slate-200 bg-slate-50 rounded-sm flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">Unresolved</span>
                <span className="mono-text text-[10px] text-slate-500">Not found in GBIF Backbone</span>
              </div>
              <span className="material-symbols-outlined text-slate-400 scale-75">help</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
