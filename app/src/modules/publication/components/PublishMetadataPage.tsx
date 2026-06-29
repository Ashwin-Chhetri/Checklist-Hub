"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Checklist, ChecklistContributor, ChecklistLicense, ChecklistMetadata } from "@/types/checklist.types";
import type { Species } from "@/types/species.types";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { useProfile } from "@/modules/auth/hooks/useProfile";
import AppHeader from "@/components/shared/AppHeader";
import { useSaveChecklistMetadata } from "../hooks/useSaveChecklistMetadata";
import { usePublicationHistory } from "../hooks/usePublicationHistory";
import {
  buildDatasetSummary,
  buildSourceSummary,
  buildTaxonomicTree,
  temporalRange,
  temporalCoverage,
  type TaxonomicTreeKingdom,
  type TemporalRecordProvenance,
} from "../utils/checklistStats";
import { EMPTY_METADATA, seedMetadataDefaults } from "../utils/metadataDrafts";

const LICENSES: { value: ChecklistLicense; label: string }[] = [
  { value: "CC0-1.0", label: "CC0 1.0 (Public Domain)" },
  { value: "CC-BY-4.0", label: "CC-BY 4.0 (Attribution)" },
  { value: "CC-BY-NC-4.0", label: "CC-BY-NC 4.0 (Non-Commercial)" },
];

const inputClass =
  "w-full bg-white border border-surface-dim px-2.5 py-1.5 mono-text text-[13px] text-on-surface rounded-sm focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand";

const SUMMARY_NAV = [
  { id: "dataset-summary", label: "dataset summary" },
  { id: "geography", label: "geographic scope" },
  { id: "history", label: "historical comparison" },
  { id: "sources", label: "source summary" },
  { id: "classification", label: "classification breakdown" },
];

const METADATA_NAV = [
  { id: "meta-dataset-info", label: "dataset info" },
  { id: "meta-temporal", label: "temporal coverage" },
  { id: "meta-geographic", label: "geographic coverage" },
  { id: "meta-taxonomic", label: "taxonomic coverage" },
  { id: "meta-methods", label: "methods" },
  { id: "meta-contributors", label: "contributors" },
  { id: "meta-publishing-org", label: "publishing org" },
  { id: "meta-funding", label: "funding & project" },
  { id: "meta-license", label: "license & rights" },
];

interface PublishMetadataPageProps {
  checklist: Checklist | undefined;
  checklistId: string;
  /** undefined = still loading; null = loaded, no saved metadata row yet. */
  initialMetadata: ChecklistMetadata | null | undefined;
  /** undefined = still loading. */
  initialContributors: ChecklistContributor[] | undefined;
  /** undefined = still loading. */
  acceptedSpecies: Species[] | undefined;
  onBack: () => void;
  onContinue: () => void;
}

export function PublishMetadataPage({
  checklist,
  checklistId,
  initialMetadata,
  initialContributors,
  acceptedSpecies,
  onBack,
  onContinue,
}: PublishMetadataPageProps) {
  const { data: currentUser } = useCurrentUser();
  const { data: currentProfile } = useProfile(currentUser?.id);
  const { data: history } = usePublicationHistory(checklistId);
  const saveMetadata = useSaveChecklistMetadata(checklistId);

  const [activeNav, setActiveNav] = useState<string>(SUMMARY_NAV[0].id);

  const species = useMemo(() => acceptedSpecies ?? [], [acceptedSpecies]);
  const stats = useMemo(() => buildDatasetSummary(species), [species]);
  const sourceSummary = useMemo(() => buildSourceSummary(species), [species]);
  const temporal = useMemo(() => temporalRange(species), [species]);
  const temporalSources = useMemo(() => temporalCoverage(species), [species]);
  const tree = useMemo(() => buildTaxonomicTree(species), [species]);

  const [metadata, setMetadata] = useState<Partial<ChecklistMetadata>>(EMPTY_METADATA);
  const [contributors, setContributors] = useState<ChecklistContributor[]>([
    { name: "", role: "Creator", institution: "", orcid: "", email: "" },
  ]);
  const [keywordInput, setKeywordInput] = useState("");

  // Every source this page seeds its form from (saved metadata, saved
  // contributors, the checklist record, accepted species for stats/temporal
  // defaults) can still be loading at mount time — especially landing here
  // directly from the checklists list's metadata sub-row, which skips the
  // earlier wizard steps that would otherwise have already resolved these.
  // A `useState(() => ...)` lazy initializer only runs once at mount and
  // would freeze on whichever of these happened to still be loading then;
  // this re-checks on every render (React's recommended pattern for
  // one-time derived state from an async value) until everything has
  // actually arrived, then seeds once.
  const dataReady =
    checklist !== undefined &&
    initialMetadata !== undefined &&
    initialContributors !== undefined &&
    acceptedSpecies !== undefined;
  const [seeded, setSeeded] = useState(false);
  if (!seeded && dataReady) {
    setSeeded(true);
    setMetadata(seedMetadataDefaults(initialMetadata ?? null, checklist, stats, temporal, sourceSummary));
    if (initialContributors.length > 0) setContributors(initialContributors);
  }

  // Seeds the first Creator row from the current user's profile once it
  // loads, but only after the base seeding above has run and the row is
  // still the untouched placeholder (i.e. there were no saved contributors).
  const [contributorProfileSeeded, setContributorProfileSeeded] = useState(false);
  if (seeded && !contributorProfileSeeded && currentProfile && contributors.length === 1 && !contributors[0].name.trim()) {
    setContributorProfileSeeded(true);
    setContributors([
      {
        name: currentProfile.full_name ?? "",
        role: "Creator",
        institution: currentProfile.institution ?? "",
        orcid: "",
        email: currentProfile.email ?? "",
      },
    ]);
  }

  // Whether the user has made a genuine edit yet (as opposed to the
  // seeding above merely populating defaults) — the autosave effect below
  // only fires once this is true, so simply *opening* this page (e.g. to
  // check on a checklist whose metadata was just deleted) can never
  // silently recreate the row 2s later with zero interaction.
  const [hasEdited, setHasEdited] = useState(false);

  function set<K extends keyof ChecklistMetadata>(key: K, value: ChecklistMetadata[K]) {
    setHasEdited(true);
    setMetadata((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDataSource(source: string) {
    const current = metadata.methods_data_sources ?? [];
    set("methods_data_sources", current.includes(source) ? current.filter((s) => s !== source) : [...current, source]);
  }

  function addKeyword() {
    const value = keywordInput.trim().toUpperCase();
    if (!value) return;
    const current = metadata.keywords ?? [];
    if (!current.includes(value)) set("keywords", [...current, value]);
    setKeywordInput("");
  }

  function removeKeyword(keyword: string) {
    set("keywords", (metadata.keywords ?? []).filter((k) => k !== keyword));
  }

  function updateContributor(index: number, patch: Partial<ChecklistContributor>) {
    setHasEdited(true);
    setContributors((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  const newContributorNameRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusNewContributorRef = useRef(false);

  function addContributor() {
    shouldFocusNewContributorRef.current = true;
    setHasEdited(true);
    setContributors((prev) => [...prev, { name: "", role: "Creator", institution: "", orcid: "", email: "" }]);
  }

  function removeContributor(index: number) {
    setHasEdited(true);
    setContributors((prev) => prev.filter((_, i) => i !== index));
  }

  // Focuses the newly added contributor row's Name input right after the DOM
  // commits it — must run in an effect (not during render) since the input
  // doesn't exist yet until after this render's commit.
  useEffect(() => {
    if (shouldFocusNewContributorRef.current) {
      shouldFocusNewContributorRef.current = false;
      newContributorNameRef.current?.focus();
    }
  }, [contributors.length]);

  const completion = {
    title: Boolean(checklist?.title?.trim()),
    abstract: Boolean(metadata.abstract?.trim()),
    taxonomy: Boolean(metadata.taxonomic_scope_description?.trim() || checklist?.taxonomic_scope?.kingdom),
    geography: Boolean(checklist?.region_country || checklist?.region_name),
    temporal: metadata.temporal_earliest_year != null && metadata.temporal_latest_year != null,
    authors: contributors.some((c) => c.name.trim()),
  };
  const allComplete = Object.values(completion).every(Boolean);

  function handleGeneratePackage() {
    saveMetadata.mutate(
      { metadata, contributors: contributors.filter((c) => c.name.trim()) },
      { onSuccess: onContinue },
    );
  }

  function handleSaveDraft() {
    saveMetadata.mutate({ metadata, contributors: contributors.filter((c) => c.name.trim()) });
  }

  // Auto-save the draft 2s after the user stops editing — debounced via the
  // effect's own cleanup (each metadata/contributors change cancels the
  // previous timer and starts a new one), so the mutate() call only ever
  // fires from a deferred timeout callback, never synchronously in the
  // effect body itself. Guarded on `seeded && hasEdited` so neither a slow
  // network (pre-seed empty placeholder state) nor the seeding itself
  // (populating defaults is not an edit) can trigger a save — without the
  // latter guard, simply *opening* this page on a checklist whose metadata
  // was just deleted would silently recreate the row 2s later with zero
  // user interaction, since seeding alone changes metadata/contributors.
  useEffect(() => {
    if (!seeded || !hasEdited) return;
    const timer = setTimeout(() => {
      saveMetadata.mutate({ metadata, contributors: contributors.filter((c) => c.name.trim()) });
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata, contributors, seeded, hasEdited]);

  function scrollToSection(id: string) {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const ids = [...SUMMARY_NAV, ...METADATA_NAV].map((item) => item.id);
    const elements = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveNav(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -70% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tree.length]);

  const historyDiff = useMemo(() => {
    if (!history) return null;
    const previousIds = new Set(history.species_ids);
    const currentIds = new Set(species.map((s) => s.id));
    const added = species.filter((s) => !previousIds.has(s.id)).length;
    const removed = history.species_ids.filter((id) => !currentIds.has(id)).length;
    return { added, removed };
  }, [history, species]);

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      <header className="h-14 border-b border-surface-dim bg-white flex items-center justify-between px-4 z-50 sticky top-0">
        <div className="flex items-center gap-6">
          <AppHeader />
          <button
            type="button"
            onClick={onBack}
            className="bg-brand text-white px-3 py-1.5 rounded-sm text-xs mono-text font-medium flex items-center gap-2 shadow-hard hover:translate-y-[-1px] transition-transform"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Validation
          </button>
        </div>
        <div className="flex items-center gap-3">
          {saveMetadata.isSuccess && !saveMetadata.isPending && (
            <span className="font-code-md text-[10px] text-secondary">Draft saved</span>
          )}
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={saveMetadata.isPending}
            className="px-3 py-1.5 bg-white border border-surface-dim text-secondary text-[10px] mono-text font-bold uppercase rounded-sm flex items-center gap-2 hover:border-brand hover:text-brand transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">save</span>
            {saveMetadata.isPending ? "Saving..." : "Save Draft"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 mx-auto w-full">
        <aside className="hidden lg:flex flex-col sticky h-[calc(100vh-3.5rem)] border-r border-surface-dim py-10 px-6 w-56 top-14 overflow-hidden">
          <nav className="flex-1 overflow-y-auto pr-2 space-y-6">
            <div>
              <div className="font-label-caps text-[12px] font-bold uppercase tracking-widest mb-2 px-1 text-secondary">
                checklist summary
              </div>
              <div className="flex flex-col gap-2">
                {SUMMARY_NAV.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSection(item.id)}
                    className={`mono-text text-[11px] font-bold uppercase tracking-wider flex items-center gap-3 py-1 px-2 text-left transition-colors hover:bg-brand/5 ${
                      activeNav === item.id ? "border-l-2 border-brand text-brand bg-brand/5" : "border-l-2 border-transparent"
                    }`}
                  >
                    <span className="text-brand/40 font-mono">{String(i + 1).padStart(2, "0")}</span> {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-label-caps text-[12px] font-bold uppercase tracking-widest mb-2 px-1 text-secondary">
                checklist metadata
              </div>
              <div className="flex flex-col gap-2">
                {METADATA_NAV.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSection(item.id)}
                    className={`mono-text text-[11px] font-bold uppercase tracking-wider flex items-center gap-3 py-1 px-2 text-left transition-colors hover:bg-brand/5 ${
                      activeNav === item.id ? "border-l-2 border-brand text-brand bg-brand/5" : "border-l-2 border-transparent"
                    }`}
                  >
                    <span className="text-brand/40 font-mono">{String(i + 1).padStart(2, "0")}</span> {item.label}
                  </button>
                ))}
              </div>
            </div>
          </nav>
          <div className="mt-auto pt-6 border-t border-surface-dim">
            <h3 className="font-label-caps text-[9px] text-secondary uppercase font-bold mb-3 tracking-widest">
              Checklist Completion
            </h3>
            <div className="space-y-1.5">
              <CompletionRow ok={completion.title} label="Title Complete" />
              <CompletionRow ok={completion.abstract} label="Abstract Provided" />
              <CompletionRow ok={completion.taxonomy} label="Taxonomy Scope" />
              <CompletionRow ok={completion.geography} label="Geography Set" />
              <CompletionRow ok={completion.temporal} label="Temporal Valid" />
              <CompletionRow ok={completion.authors} label="Authors Added" />
            </div>
            <div
              className={`p-2 mt-3 flex items-center gap-2 border ${
                allComplete ? "bg-emerald-50 border-emerald-600/20" : "bg-amber-50 border-amber-600/20"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${allComplete ? "bg-emerald-500" : "bg-amber-500"} animate-pulse`} />
              <span
                className={`font-label-caps text-[8px] font-bold uppercase ${allComplete ? "text-emerald-700" : "text-amber-700"}`}
              >
                {allComplete ? "Ready" : "Incomplete"}
              </span>
            </div>
          </div>
        </aside>

        <main className="flex-grow px-6 py-10">
          <div className="mb-10">
            <h1 className="text-3xl font-bold mb-2">Checklist Summary</h1>
            <p className="font-body-lg text-secondary">Review the final composition of your checklist before publication.</p>
          </div>

          <div className="space-y-6">
            <section id="dataset-summary" className="scroll-mt-20">
              <SectionHeading title="SECTION 1: Dataset Summary" />
              <div className="bg-white border border-surface-dim border-t-2 border-t-secondary/30 p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatTile label="Species" value={stats.total} />
                  <StatTile label="Families" value={stats.families} />
                  <StatTile label="Orders" value={stats.orders} />
                  <StatTile label="Genera" value={stats.genera} />
                </div>
              </div>
            </section>

            <section id="geography" className="scroll-mt-20">
              <SectionHeading title="SECTION 2: Geographic Scope" />
              <div className="bg-white border border-surface-dim border-t-2 border-t-secondary/30 p-6 space-y-1">
                <LineItem label="Region" value={[checklist?.region_name, checklist?.region_state, checklist?.region_country].filter(Boolean).join(", ") || "—"} />
              </div>
            </section>

            <section id="history" className="scroll-mt-20">
              <SectionHeading title="SECTION 3: Historical Comparison" />
              <div className="bg-white border border-surface-dim border-t-2 border-t-secondary/30 p-6 space-y-1">
                {history && historyDiff ? (
                  <>
                    <LineItem label="Previous Record" value={new Date(history.published_at).toLocaleDateString()} />
                    <LineItem label="Species Added" value={`+${historyDiff.added}`} tone="emerald" />
                    <LineItem label="Removed" value={`-${historyDiff.removed}`} tone="error" />
                    <LineItem label="Previous Species Count" value={String(history.species_count)} />
                  </>
                ) : (
                  <p className="font-code-md text-sm text-secondary py-2">No previous publication on record.</p>
                )}
              </div>
            </section>

            <section id="sources" className="scroll-mt-20">
              <SectionHeading title="SECTION 4: Source Summary" />
              <div className="bg-white border border-surface-dim border-t-2 border-t-secondary/50 p-6 space-y-1">
                {sourceSummary.length === 0 ? (
                  <p className="font-code-md text-sm text-secondary py-2">No evidence source records on accepted species yet.</p>
                ) : (
                  sourceSummary.map((row) => <LineItem key={row.source} label={row.label} value={`${row.recordCount} Records`} />)
                )}
              </div>
            </section>

            <section id="classification" className="scroll-mt-20">
              <SectionHeading title="SECTION 5: Classification Breakdown" />
              <div className="bg-white border border-surface-dim border-t-2 border-t-secondary/50 p-6">
                <ClassificationTree tree={tree} />
              </div>
            </section>

            <section id="metadata" className="scroll-mt-20">
              <div className="mb-8 mt-4">
                <h2 className="font-headline-md uppercase tracking-widest font-bold">Checklist Metadata</h2>
                <p className="font-body-sm text-secondary">
                  Complete the publication metadata required for Darwin Core and GBIF/IPT publication.
                </p>
              </div>

              <div className="space-y-6">
                <div id="meta-dataset-info" className="bg-white border-t-2 border-t-brand p-6 scroll-mt-20">
                  <SubHeading title="SECTION 1 — DATASET INFORMATION" />
                  <Field label="Dataset Title">
                    <input className={`${inputClass} tech-readonly bg-surface-container-low text-secondary`} readOnly value={checklist?.title ?? ""} />
                  </Field>
                  <Field label="Keywords">
                    <div className="flex flex-wrap gap-2 p-1.5 border border-surface-dim bg-white items-center">
                      {(metadata.keywords ?? []).map((k) => (
                        <span key={k} className="bg-brand/10 text-brand text-[10px] px-2 py-0.5 font-bold border border-brand/20 flex items-center gap-1">
                          {k}
                          <button type="button" onClick={() => removeKeyword(k)} className="hover:text-error">
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        className="border-none p-0 ml-1 text-[10px] w-24 outline-none"
                        placeholder="+ Add..."
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === "," || e.key === " ") {
                            e.preventDefault();
                            addKeyword();
                          }
                        }}
                        onBlur={addKeyword}
                      />
                    </div>
                  </Field>
                  <Field label="Language">
                    <input className={inputClass} value={metadata.language ?? "English"} onChange={(e) => set("language", e.target.value)} />
                  </Field>
                  <Field label="Short Description">
                    <textarea className={`${inputClass} h-16`} value={metadata.short_description ?? ""} onChange={(e) => set("short_description", e.target.value)} />
                  </Field>
                  <Field label="Purpose">
                    <textarea className={`${inputClass} h-16`} value={metadata.purpose ?? ""} onChange={(e) => set("purpose", e.target.value)} />
                  </Field>
                  <Field label="Abstract">
                    <textarea className={`${inputClass} h-28`} value={metadata.abstract ?? ""} onChange={(e) => set("abstract", e.target.value)} />
                  </Field>
                  <Field label="Dataset Type">
                    <input className={`${inputClass} tech-readonly bg-surface-container-low text-secondary`} readOnly value={metadata.dataset_type ?? "Species Checklist"} />
                  </Field>
                </div>

                <div id="meta-temporal" className="bg-white border-t-2 border-t-secondary/30 p-6 scroll-mt-20">
                  <SubHeading title="SECTION 2 — TEMPORAL COVERAGE" />
                  <Field label="Earliest Record Year">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className={inputClass}
                        value={metadata.temporal_earliest_year ?? ""}
                        onChange={(e) => set("temporal_earliest_year", e.target.value ? Number(e.target.value) : null)}
                      />
                      <TemporalProvenanceHint
                        record={temporalSources.earliest}
                        currentValue={metadata.temporal_earliest_year ?? null}
                      />
                    </div>
                  </Field>
                  <Field label="Latest Record Year">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className={inputClass}
                        value={metadata.temporal_latest_year ?? ""}
                        onChange={(e) => set("temporal_latest_year", e.target.value ? Number(e.target.value) : null)}
                      />
                      <TemporalProvenanceHint
                        record={temporalSources.latest}
                        currentValue={metadata.temporal_latest_year ?? null}
                      />
                    </div>
                  </Field>
                  <Field label="Coverage Description">
                    <textarea className={`${inputClass} h-16`} value={metadata.temporal_coverage_description ?? ""} onChange={(e) => set("temporal_coverage_description", e.target.value)} />
                  </Field>
                </div>

                <div id="meta-geographic" className="bg-white border-t-2 border-t-secondary/30 p-6 scroll-mt-20">
                  <SubHeading title="SECTION 3 — GEOGRAPHIC COVERAGE" />
                  <Field label="Country">
                    <input className={inputClass} value={metadata.geo_country ?? checklist?.region_country ?? ""} onChange={(e) => set("geo_country", e.target.value)} />
                  </Field>
                  <Field label="State / Province">
                    <input className={inputClass} value={metadata.geo_state ?? checklist?.region_state ?? ""} onChange={(e) => set("geo_state", e.target.value)} />
                  </Field>
                  {checklist?.region_district && (
                    <Field label="Region Name">
                      <input className={inputClass} value={metadata.geo_region_name ?? checklist?.region_name ?? ""} onChange={(e) => set("geo_region_name", e.target.value)} />
                    </Field>
                  )}
                  <Field label="Elevation Range (m)">
                    <input className={inputClass} placeholder="e.g. 120 – 3,636" value={metadata.geo_elevation_range ?? ""} onChange={(e) => set("geo_elevation_range", e.target.value)} />
                  </Field>
                  {(checklist?.region_gadm_id || checklist?.region_osm_id) && (
                    <p className="text-[11px] text-secondary mono-text mb-3">
                      Bounding coordinates for EML are computed automatically from this checklist&apos;s region
                      boundary ({checklist.region_gadm_id ? `GADM ${checklist.region_gadm_id}` : `OSM ${checklist.region_osm_type}/${checklist.region_osm_id}`}) at package-generation time — no manual entry needed.
                    </p>
                  )}
                  <Field label="Geographic Description">
                    <textarea className={`${inputClass} h-16`} value={metadata.geo_description ?? ""} onChange={(e) => set("geo_description", e.target.value)} />
                  </Field>
                </div>

                <div id="meta-taxonomic" className="bg-white border-t-2 border-t-secondary/30 p-6 scroll-mt-20">
                  <SubHeading title="SECTION 4 — TAXONOMIC COVERAGE" />
                  <Field label="Core Taxonomy">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <TaxonTile label="Kingdom" value={checklist?.taxonomic_scope?.kingdom ?? "—"} />
                      <TaxonTile label="Phylum" value={checklist?.taxonomic_scope?.phylum ?? "—"} />
                      <TaxonTile label="Class" value={checklist?.taxonomic_scope?.class ?? "—"} />
                      <TaxonTile label="Taxa Counts" value={`${stats.families} Fam / ${stats.total} Spp`} accent />
                    </div>
                  </Field>
                  <Field label="Scope Description">
                    <textarea className={`${inputClass} h-20`} value={metadata.taxonomic_scope_description ?? ""} onChange={(e) => set("taxonomic_scope_description", e.target.value)} />
                  </Field>
                </div>

                <div id="meta-methods" className="bg-white border-t-2 border-t-secondary/30 p-6 scroll-mt-20">
                  <SubHeading title="SECTION 5 — METHODS" />
                  <Field label="Data Sources">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-4 p-3 border border-surface-dim bg-white">
                      {["GBIF", "eBird", "iNaturalist", "Literature", "Other Records"].map((source) => (
                        <label key={source} className="flex items-center gap-2 font-code-md text-[11px]">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={(metadata.methods_data_sources ?? []).includes(source)}
                            onChange={() => toggleDataSource(source)}
                          />
                          {source}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="Methodology">
                    <textarea className={`${inputClass} h-16`} value={metadata.methodology ?? ""} onChange={(e) => set("methodology", e.target.value)} />
                  </Field>
                  <Field label="Taxonomic Validation">
                    <textarea className={`${inputClass} h-16`} value={metadata.taxonomic_validation ?? ""} onChange={(e) => set("taxonomic_validation", e.target.value)} />
                  </Field>
                  <Field label="Evidence Evaluation">
                    <textarea className={`${inputClass} h-16`} value={metadata.evidence_evaluation ?? ""} onChange={(e) => set("evidence_evaluation", e.target.value)} />
                  </Field>
                  <Field label="Criteria">
                    <textarea className={`${inputClass} h-16`} value={metadata.criteria ?? ""} onChange={(e) => set("criteria", e.target.value)} />
                  </Field>
                  <Field label="Reviewer Notes">
                    <textarea className={`${inputClass} h-16`} value={metadata.reviewer_notes ?? ""} onChange={(e) => set("reviewer_notes", e.target.value)} />
                  </Field>
                </div>

                <div id="meta-contributors" className="bg-white border-t-2 border-t-secondary/30 p-6 scroll-mt-20">
                  <SubHeading title="SECTION 6 — CONTRIBUTORS" />
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-surface-container text-[9px] text-secondary uppercase text-left">
                          <th className="p-2 border border-surface-dim">Name</th>
                          <th className="p-2 border border-surface-dim w-32">Role</th>
                          <th className="p-2 border border-surface-dim">Institution</th>
                          <th className="p-2 border border-surface-dim">ORCID</th>
                          <th className="p-2 border border-surface-dim">Email</th>
                          <th className="p-2 border border-surface-dim w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {contributors.map((c, i) => (
                          <tr key={i}>
                            <td className="p-2 border border-surface-dim">
                              <input
                                ref={i === contributors.length - 1 ? newContributorNameRef : undefined}
                                className="w-full border-none p-0 outline-none text-[11px]"
                                value={c.name}
                                onChange={(e) => updateContributor(i, { name: e.target.value })}
                              />
                            </td>
                            <td className="p-2 border border-surface-dim">
                              <select
                                className="w-full border-none p-0 outline-none text-[11px] bg-transparent"
                                value={c.role}
                                onChange={(e) => updateContributor(i, { role: e.target.value as ChecklistContributor["role"] })}
                              >
                                <option>Creator</option>
                                <option>Curator</option>
                                <option>Reviewer</option>
                                <option>Author</option>
                              </select>
                            </td>
                            <td className="p-2 border border-surface-dim">
                              <input className="w-full border-none p-0 outline-none text-[11px]" value={c.institution ?? ""} onChange={(e) => updateContributor(i, { institution: e.target.value })} />
                            </td>
                            <td className="p-2 border border-surface-dim">
                              <input className="w-full border-none p-0 outline-none text-[11px]" value={c.orcid ?? ""} onChange={(e) => updateContributor(i, { orcid: e.target.value })} />
                            </td>
                            <td className="p-2 border border-surface-dim">
                              <input className="w-full border-none p-0 outline-none text-[11px]" value={c.email ?? ""} onChange={(e) => updateContributor(i, { email: e.target.value })} />
                            </td>
                            <td className="p-2 border border-surface-dim text-center">
                              <button type="button" onClick={() => removeContributor(i)} className="material-symbols-outlined text-sm text-secondary hover:text-error">
                                delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    onClick={addContributor}
                    className="mt-3 font-code-md text-[10px] text-brand border border-brand/50 px-3 py-1 flex items-center gap-1 hover:bg-brand/5 transition-colors uppercase font-bold"
                  >
                    + Add Contributor
                  </button>
                </div>

                <div id="meta-publishing-org" className="bg-white border-t-2 border-t-secondary/30 p-6 scroll-mt-20">
                  <SubHeading title="SECTION 7 — PUBLISHING ORGANIZATION" />
                  <Field label="Organization Name">
                    <input className={inputClass} value={metadata.publishing_org_name ?? ""} onChange={(e) => set("publishing_org_name", e.target.value)} />
                  </Field>
                  <Field label="Organization Website">
                    <input className={inputClass} value={metadata.publishing_org_website ?? ""} onChange={(e) => set("publishing_org_website", e.target.value)} />
                  </Field>
                  <Field label="Institution Code">
                    <input className={inputClass} value={metadata.institution_code ?? ""} onChange={(e) => set("institution_code", e.target.value)} />
                  </Field>
                  <Field label="Publishing Contact">
                    <input className={inputClass} value={metadata.publishing_contact ?? ""} onChange={(e) => set("publishing_contact", e.target.value)} />
                  </Field>
                  <Field label="Resource Contact">
                    <input className={inputClass} value={metadata.resource_contact ?? ""} onChange={(e) => set("resource_contact", e.target.value)} />
                  </Field>
                </div>

                <div id="meta-funding" className="bg-white border-t-2 border-t-secondary/30 p-6 scroll-mt-20">
                  <SubHeading title="SECTION 8 — FUNDING & PROJECT" />
                  <Field label="Funded Project">
                    <label className="flex items-center gap-2 font-code-md text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={metadata.is_funded ?? false}
                        onChange={(e) => set("is_funded", e.target.checked)}
                      />
                      This checklist was produced under a funded project or programme
                    </label>
                  </Field>
                  {metadata.is_funded && (
                    <>
                      <Field label="Project ID">
                        <input
                          className={inputClass}
                          placeholder="e.g. BID-AF2016-0001-REG"
                          value={metadata.project_id ?? ""}
                          onChange={(e) => set("project_id", e.target.value)}
                        />
                      </Field>
                      <Field label="Project Title">
                        <input className={inputClass} value={metadata.project_title ?? ""} onChange={(e) => set("project_title", e.target.value)} />
                      </Field>
                      <Field label="Funding / Funder">
                        <textarea
                          className={`${inputClass} h-16`}
                          value={metadata.funding_description ?? ""}
                          onChange={(e) => set("funding_description", e.target.value)}
                        />
                      </Field>
                    </>
                  )}
                </div>

                <div id="meta-license" className="bg-white border-t-2 border-t-secondary/30 p-6 scroll-mt-20">
                  <SubHeading title="SECTION 9 — LICENSE & RIGHTS" />
                  <Field label="License Selection">
                    <div className="space-y-2">
                      {LICENSES.map((l) => (
                        <label key={l.value} className="flex items-center gap-2 font-code-md text-[11px] cursor-pointer">
                          <input type="radio" name="license" checked={metadata.license === l.value} onChange={() => set("license", l.value)} />
                          {l.label}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="Rights Statement">
                    <input className={inputClass} value={metadata.rights_statement ?? ""} onChange={(e) => set("rights_statement", e.target.value)} />
                  </Field>
                  <Field label="Usage Notes">
                    <input className={inputClass} placeholder="Special attribution requirements..." value={metadata.usage_notes ?? ""} onChange={(e) => set("usage_notes", e.target.value)} />
                  </Field>
                </div>

              </div>
            </section>
          </div>

          <section className="mt-10">
            <div className="bg-brand text-white p-6 border border-on-background shadow-hard flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-1.5 h-8 bg-white" />
                <div className="flex flex-col">
                  <h3 className="font-label-caps text-base uppercase tracking-[0.2em] font-bold">PUBLICATION READY</h3>
                  <div className="flex gap-4 font-code-md text-[10px] opacity-90 uppercase tracking-wider">
                    <span>{stats.total} Accepted Species</span>
                    <span className="opacity-40">•</span>
                    <span>{stats.families} Families</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={onBack} className="text-white/80 mono-text text-[10px] uppercase font-bold hover:underline">
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleGeneratePackage}
                  disabled={saveMetadata.isPending}
                  className="bg-white text-brand px-6 py-4 font-headline-md text-sm font-bold uppercase tracking-widest border border-on-background shadow-hard flex items-center gap-3 hover:translate-y-[-2px] transition-transform disabled:opacity-50"
                >
                  {saveMetadata.isPending ? "Saving..." : "Generate Publication Package"}
                  <span className="material-symbols-outlined">arrow_forward</span>
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-4 mb-3 mt-4 pb-4">
      <h2 className="font-label-caps text-xs text-secondary uppercase tracking-widest font-bold">{title}</h2>
    </div>
  );
}

function SubHeading({ title }: { title: string }) {
  return <h3 className="font-label-caps text-xs text-secondary uppercase tracking-widest font-bold mb-4 pb-4 border-b border-surface-container">{title}</h3>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start py-3 border-b border-surface-container last:border-b-0">
      <label className="font-label-caps text-[10px] font-bold uppercase text-on-surface-variant pt-1.5">{label}</label>
      {children}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-container-low p-4 border border-surface-dim flex flex-col gap-1">
      <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest">{label}</span>
      <span className="font-code-md text-xl font-bold">{value}</span>
    </div>
  );
}

function TaxonTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`bg-surface-container p-2 border border-surface-dim ${accent ? "border-l-4 border-l-brand" : ""}`}>
      <div className="font-label-caps text-[8px] uppercase text-on-surface-variant font-bold">{label}</div>
      <div className="font-code-md text-[11px] font-bold">{value}</div>
    </div>
  );
}

function LineItem({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "error" }) {
  const toneClass = tone === "emerald" ? "text-emerald-600" : tone === "error" ? "text-error" : "text-on-surface";
  return (
    <div className="flex items-baseline gap-3 py-3 border-b border-surface-container last:border-b-0">
      <span className="font-label-caps text-[10px] text-on-surface-variant uppercase w-40 flex-shrink-0">{label}</span>
      <span className={`font-code-md text-sm font-bold ${toneClass}`}>{value}</span>
    </div>
  );
}

/** Hover detail for an auto-filled Earliest/Latest Record Year — only shown while the field still matches what was auto-computed, since typing a different year means the field no longer reflects this provenance. */
function TemporalProvenanceHint({
  record,
  currentValue,
}: {
  record: TemporalRecordProvenance | null;
  currentValue: number | null;
}) {
  if (!record || record.year !== currentValue) return null;
  return (
    <span
      className="material-symbols-outlined text-[16px] text-secondary cursor-help shrink-0"
      title={`${record.year} — ${record.sourceLabel} record on ${record.speciesName}`}
    >
      info
    </span>
  );
}

function CompletionRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 font-code-md text-[9px] ${ok ? "text-emerald-600" : "text-slate-400"}`}>
      <span className="material-symbols-outlined text-[12px] font-bold">{ok ? "check_circle" : "radio_button_unchecked"}</span> {label}
    </div>
  );
}

function ClassificationTree({ tree }: { tree: TaxonomicTreeKingdom[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const query = search.trim().toLowerCase();

  return (
    <div>
      <div className="flex items-center justify-between mb-4 border-b border-surface-container pb-2">
        <h3 className="font-label-caps text-[11px] text-secondary uppercase font-bold">Taxonomic Hierarchy</h3>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setCollapsed(new Set())} className="font-code-md text-[10px] text-brand uppercase hover:underline">
            Expand All
          </button>
          <span className="text-surface-dim">|</span>
          <button
            type="button"
            onClick={() => {
              const keys: string[] = [];
              for (const k of tree) {
                keys.push(k.name);
                for (const p of k.phyla) {
                  keys.push(`${k.name}/${p.name}`);
                  for (const c of p.classes) keys.push(`${k.name}/${p.name}/${c.name}`);
                }
              }
              setCollapsed(new Set(keys));
            }}
            className="font-code-md text-[10px] text-secondary uppercase hover:underline"
          >
            Collapse All
          </button>
        </div>
      </div>
      <div className="mb-4 relative">
        <input
          className="w-full bg-surface-container-low border border-surface-dim rounded-sm px-3 py-2 pl-10 font-body-sm text-xs focus:ring-1 focus:ring-brand focus:border-brand"
          placeholder="Search taxonomic hierarchy..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="material-symbols-outlined absolute left-3 top-2 text-[18px] text-secondary">search</span>
      </div>
      <div className="font-code-md text-xs space-y-1 overflow-y-auto max-h-[400px] pr-2">
        {tree.map((kingdom) => (
          <TreeNode
            key={kingdom.name}
            nodeKey={kingdom.name}
            label={`Kingdom: ${kingdom.name}`}
            bold
            collapsed={collapsed}
            onToggle={toggle}
            query={query}
          >
            {kingdom.phyla.map((phylum) => (
              <TreeNode
                key={phylum.name}
                nodeKey={`${kingdom.name}/${phylum.name}`}
                label={`Phylum: ${phylum.name}`}
                collapsed={collapsed}
                onToggle={toggle}
                query={query}
              >
                {phylum.classes.map((klass) => (
                  <TreeNode
                    key={klass.name}
                    nodeKey={`${kingdom.name}/${phylum.name}/${klass.name}`}
                    label={`Class: ${klass.name}`}
                    collapsed={collapsed}
                    onToggle={toggle}
                    query={query}
                  >
                    {klass.orders.map((order) => {
                      if (query && !order.name.toLowerCase().includes(query)) return null;
                      return (
                        <div key={order.name} className="flex items-center gap-2 py-1 px-1 ml-5">
                          <span className="w-5 flex-shrink-0" />
                          <span>Order: {order.name}</span>
                          <span className="text-[10px] text-secondary ml-auto">{order.speciesCount} Species</span>
                        </div>
                      );
                    })}
                  </TreeNode>
                ))}
              </TreeNode>
            ))}
          </TreeNode>
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  nodeKey,
  label,
  bold,
  collapsed,
  onToggle,
  query,
  children,
}: {
  nodeKey: string;
  label: string;
  bold?: boolean;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  query: string;
  children: React.ReactNode;
}) {
  const isCollapsed = collapsed.has(nodeKey) && !query;
  return (
    <div className="ml-2">
      <div className="flex items-center gap-2 cursor-pointer group py-1 px-1" onClick={() => onToggle(nodeKey)}>
        <span className={`material-symbols-outlined text-sm text-secondary group-hover:text-brand transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
          expand_more
        </span>
        <span className={bold ? "font-bold text-brand" : "font-bold"}>{label}</span>
      </div>
      {!isCollapsed && <div className="ml-4 border-l border-surface-dim pl-2">{children}</div>}
    </div>
  );
}
