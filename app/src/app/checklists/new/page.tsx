"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCreateChecklist } from "@/modules/checklist/hooks/useCreateChecklist";
import { useEmailLookup, useProfileSearch } from "@/modules/checklist/hooks/useChecklist";
import { isValidEmailFormat } from "@/lib/validation/email";
import {
  mergeParsedFiles,
  type ParsedFileResult,
  type ParsedSpeciesRow,
} from "@/modules/checklist/utils/speciesFileParser";
import type { CollaboratorInviteInput, TaxonomicScope } from "@/types/checklist.types";
import { TaxonomicScopeSelector } from "@/components/checklist-wizard/step1/TaxonomicScopeSelector";
import { RegionInput, type RegionValue } from "@/components/checklist-wizard/step1/RegionInput";
import { SpeciesDiscoveryPanel } from "@/components/checklist-wizard/step2/discovery/SpeciesDiscoveryPanel";
import { SpeciesInventoryPanel } from "@/components/checklist-wizard/step2/discovery/SpeciesInventoryPanel";
import type { RawSpeciesRecord } from "@/modules/evidence/discovery/types";
import {
  clearDraft,
  loadDraft,
  saveDraftCsvRows,
  saveDraftImportIssues,
  saveDraftMeta,
  saveDraftSpecies,
  type DraftMeta,
} from "@/modules/checklist/utils/draftStore";

const STEPS = [
  { id: 1, label: "Details" },
  { id: 2, label: "Import" },
  { id: 3, label: "Validate" },
  { id: 4, label: "Collab" },
  { id: 5, label: "Create" },
];

const DEFAULT_REGION: RegionValue = {
  region_name: "",
  region_district: "",
  region_state: "",
  region_country: "",
  region_gadm_id: "",
  region_pin: "",
};

export default function NewChecklistPage() {
  const router = useRouter();
  const createChecklist = useCreateChecklist();

  // Whether the IndexedDB draft has finished loading. Persistence is skipped
  // until then, so we don't overwrite a saved draft with initial defaults.
  const [draftLoaded, setDraftLoaded] = useState(false);

  const [step, setStep] = useState(1);

  // "Scroll for more" cue for Step 3 (the species table can push the
  // Back/Continue footer below the fold). Visible the entire time the dialog's
  // bottom section is out of view — at the top, mid-scroll, or anywhere in
  // between — and hidden only once the bottom is actually reached, or on any
  // other step.
  const dialogScrollRef = useRef<HTMLDivElement>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);

  useEffect(() => {
    const el = dialogScrollRef.current;
    if (step !== 3 || !el) {
      setShowScrollHint(false);
      return;
    }

    const NEAR_BOTTOM_PX = 24;

    function evaluate() {
      if (!el) return;
      const isScrollable = el.scrollHeight > el.clientHeight + NEAR_BOTTOM_PX;
      const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX;
      setShowScrollHint(isScrollable && !isNearBottom);
    }

    evaluate();
    el.addEventListener("scroll", evaluate, { passive: true });
    // Content height changes as the species table loads/filters — re-check then too.
    const resizeObserver = new ResizeObserver(evaluate);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", evaluate);
      resizeObserver.disconnect();
    };
  }, [step]);

  function scrollHintClick() {
    dialogScrollRef.current?.scrollBy({ top: dialogScrollRef.current.clientHeight * 0.85, behavior: "smooth" });
  }

  // Step 1 — Details
  const [title, setTitle] = useState("");
  const [taxonomicScope, setTaxonomicScope] = useState<TaxonomicScope>({});
  const [deepestTaxonKey, setDeepestTaxonKey] = useState<number | null>(null);
  const [region, setRegion] = useState<RegionValue>(DEFAULT_REGION);

  // Step 2 — Import. Kept as one entry per uploaded file (rather than a single
  // pre-merged list) so a file can be individually removed; csvRows/importIssues
  // below are recomputed from this whenever it changes.
  const [uploadedFiles, setUploadedFiles] = useState<ParsedFileResult[]>([]);
  const { rows: csvRows, issues: importIssues } = useMemo(() => mergeParsedFiles(uploadedFiles), [uploadedFiles]);
  const [discoverySelection, setDiscoverySelection] = useState<Map<string, ParsedSpeciesRow>>(new Map());

  // Species "Added" from the research-pipeline Deep Search dialog — merged
  // into the same aggregator pass as discovered evidence under source:
  // "literature" (see useSpeciesInventory's literatureRecords param), not
  // persisted to the draft store (re-running Deep Search after a reload is
  // cheap; the underlying research-pipeline run itself already persists).
  const [literatureRecords, setLiteratureRecords] = useState<RawSpeciesRecord[]>([]);

  // The Deep Search dialog's in-flight/completed runId — owned here (rather
  // than inside the dialog) and persisted to the draft, so closing the
  // dialog (even accidentally) or navigating to another wizard step and
  // back resumes polling the same detached server-side run instead of
  // starting a duplicate one. Unlike literatureRecords above, this one IS
  // worth persisting: the runId string is free to store, and reattaching to
  // an existing run after a reload is strictly better than losing track of
  // it (the run keeps going on the server either way).
  const [deepSearchRunId, setDeepSearchRunId] = useState<string | null>(null);

  // Step 4 — Collab
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [collaboratorInvites, setCollaboratorInvites] = useState<CollaboratorInviteInput[]>([]);
  const [collaboratorSuggestionsOpen, setCollaboratorSuggestionsOpen] = useState(false);
  const { data: collaboratorSuggestions } = useProfileSearch(collaboratorEmail);
  const trimmedCollaboratorEmail = collaboratorEmail.trim();
  const collaboratorAlreadySuggested = collaboratorSuggestions?.some(
    (p) => p.email?.toLowerCase() === trimmedCollaboratorEmail.toLowerCase(),
  );
  const showNewCollaboratorEmailRow =
    isValidEmailFormat(trimmedCollaboratorEmail) && !collaboratorAlreadySuggested;
  const collaboratorEmailLookup = useEmailLookup(trimmedCollaboratorEmail);
  const collaboratorLookupChecking =
    showNewCollaboratorEmailRow && (collaboratorEmailLookup.isLoading || collaboratorEmailLookup.isFetching);
  const collaboratorLookupUnverified =
    showNewCollaboratorEmailRow &&
    collaboratorEmailLookup.data?.matched === false &&
    !collaboratorEmailLookup.data.verified;

  // Step 3 — full discovered-inventory totals (independent of selection), for the Step 5 summary.
  const [discoveryTotals, setDiscoveryTotals] = useState<{ totalSpecies: number; totalOccurrences: number } | null>(
    null,
  );

  // Restore a previously saved draft (if any) once on mount, so Step 3's
  // discovery results and other progress survive reloads/navigation.
  useEffect(() => {
    let cancelled = false;
    loadDraft().then(({ meta, species, csvRows: storedCsvRows, importIssues: storedIssues }) => {
      if (cancelled) return;
      if (meta) {
        setStep(meta.step);
        setTitle(meta.title);
        setTaxonomicScope(meta.taxonomicScope);
        setDeepestTaxonKey(meta.deepestTaxonKey);
        setRegion(meta.region);
        setCollaboratorInvites(meta.collaboratorInvites);
        setDiscoveryTotals(meta.discoveryTotals);
        setDiscoverySelection(new Map(meta.discoverySelection));
        setDeepSearchRunId(meta.deepSearchRunId ?? null);
      }
      // The draft only persists the already-merged rows/issues, not the
      // original per-file breakdown — restore as one removable entry rather
      // than losing the data entirely.
      if (storedCsvRows.length > 0) {
        setUploadedFiles([
          { fileName: meta?.csvFileName || "Restored upload", rows: storedCsvRows, issues: storedIssues },
        ]);
      }
      void species; // mergedRows is recomputed from csvRows + discoverySelection
      setDraftLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the full draft on every change so it survives reloads/navigation;
  // Step 5's summary is derived from this same persisted state via mergedRows.
  // csvFileName is saved only as a label for the single restored-upload entry
  // synthesized on reload (see loadDraft above) — the per-file breakdown itself isn't persisted.
  const csvFileNameSummary =
    uploadedFiles.length === 0 ? null : uploadedFiles.length === 1 ? uploadedFiles[0].fileName : `${uploadedFiles.length} files`;
  useEffect(() => {
    if (!draftLoaded) return;
    const meta: DraftMeta = {
      step,
      title,
      taxonomicScope,
      deepestTaxonKey,
      region,
      csvFileName: csvFileNameSummary,
      collaboratorInvites,
      discoveryTotals,
      discoverySelection: Array.from(discoverySelection.entries()),
      deepSearchRunId,
    };
    void saveDraftMeta(meta);
  }, [
    draftLoaded,
    step,
    title,
    taxonomicScope,
    deepestTaxonKey,
    region,
    csvFileNameSummary,
    collaboratorInvites,
    discoveryTotals,
    discoverySelection,
    deepSearchRunId,
  ]);

  // CSV rows and import issues are persisted separately since they can be
  // large and only change on Step 2 imports.
  useEffect(() => {
    if (!draftLoaded) return;
    void saveDraftCsvRows(csvRows);
  }, [draftLoaded, csvRows]);

  useEffect(() => {
    if (!draftLoaded) return;
    void saveDraftImportIssues(importIssues);
  }, [draftLoaded, importIssues]);

  // Reset discovery selections when the taxon scope or region changes, so
  // selections from a different scope don't silently carry into Step 3.
  const scopeKey = `${deepestTaxonKey}|${region.region_gadm_id}`;
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey);
  if (scopeKey !== prevScopeKey) {
    setPrevScopeKey(scopeKey);
    setDiscoverySelection(new Map());
    setLiteratureRecords([]);
    setDeepSearchRunId(null);
  }

  const mergedRows = useMemo<ParsedSpeciesRow[]>(() => {
    const map = new Map<string, ParsedSpeciesRow>();
    for (const row of csvRows) {
      map.set(row.scientific_name.trim().toLowerCase(), row);
    }
    for (const [key, row] of discoverySelection) {
      const existing = map.get(key);
      if (existing) {
        // CSV data takes precedence for occurrence_count/event_date, but
        // discovery-sourced taxonomy/evidence (no CSV equivalent) is preserved.
        map.set(key, {
          ...row,
          scientific_name: existing.scientific_name,
          common_name: existing.common_name ?? row.common_name,
          occurrence_count: existing.occurrence_count ?? row.occurrence_count,
          event_date: existing.event_date ?? row.event_date,
        });
      } else {
        map.set(key, row);
      }
    }
    return Array.from(map.values());
  }, [csvRows, discoverySelection]);

  // The merged species inventory is what gets pushed to the server at Step 5;
  // persist it so it's available even if the draft is reloaded mid-wizard.
  useEffect(() => {
    if (!draftLoaded) return;
    void saveDraftSpecies(mergedRows);
  }, [draftLoaded, mergedRows]);

  const auditStats = useMemo(() => ({ totalSpecies: mergedRows.length }), [mergedRows]);

  function addCollaborator() {
    const email = collaboratorEmail.trim().toLowerCase();
    if (!email || collaboratorInvites.some((invite) => invite.email === email)) return;
    if (showNewCollaboratorEmailRow && (collaboratorLookupChecking || collaboratorLookupUnverified)) return;
    setCollaboratorInvites((prev) => [...prev, { email }]);
    setCollaboratorEmail("");
  }

  function removeCollaborator(email: string) {
    setCollaboratorInvites((prev) => prev.filter((invite) => invite.email !== email));
  }

  function canContinue(): boolean {
    if (step === 1) return title.trim().length > 0;
    return true;
  }

  function goNext() {
    if (step < 5) setStep(step + 1);
  }

  function goBack() {
    if (step > 1) setStep(step - 1);
  }

  function handleCreate() {
    createChecklist.mutate(
      {
        title: title.trim(),
        region_name: region.region_name.trim() || undefined,
        region_district: region.region_district.trim() || undefined,
        region_state: region.region_state.trim() || undefined,
        region_country: region.region_country.trim() || undefined,
        region_gadm_id: region.region_gadm_id.trim() || undefined,
        region_osm_type: region.region_osm_type?.trim() || undefined,
        region_osm_id: region.region_osm_id?.trim() || undefined,
        region_pin: region.region_pin?.trim() || undefined,
        taxonomic_scope: taxonomicScope,
        species: mergedRows,
        invites: collaboratorInvites,
      },
      {
        onSuccess: (checklist) => {
          void clearDraft();
          router.push(`/checklists/${checklist.id}`);
        },
      },
    );
  }

  return (
    <>
      <div ref={dialogScrollRef} className="fixed inset-0 z-[100] overflow-y-auto backdrop-blur-sm bg-surface/60 p-4">
      <div className="bg-surface w-full max-w-2xl mx-auto my-8 rounded-lg shadow-xl border border-outline-variant overflow-hidden flex flex-col">
        {/* Header: title + progress bar */}
        <div className="bg-surface-container-low border-b border-outline-variant px-6 py-4 shrink-0">
          <div className="text-center mb-sm relative">
            <h2 className="text-sm font-bold text-primary">
              Create New Checklist
            </h2>
            <Link
              href="/checklists"
              onClick={() => void clearDraft()}
              className="material-symbols-outlined text-[18px] text-on-surface-variant hover:text-primary absolute right-0 top-0"
            >
              close
            </Link>
          </div>

          <div className="flex items-center gap-2">
            {STEPS.map((s) => (
              <div
                key={s.id}
                className={`flex-1 h-1 rounded-full ${step >= s.id ? "bg-primary" : "bg-outline-variant"
                  }`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            {STEPS.map((s) => (
              <span
                key={s.id}
                className={`text-[11px] font-label-caps uppercase tracking-wider ${step === s.id ? "text-primary" : "text-on-surface-variant"
                  }`}
              >
                {s.id}. {s.label.toUpperCase()}
              </span>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {step === 1 && (
              <div className="flex flex-col gap-3">
                <div className="space-y-xs">
                  <label
                    className="text-sm font-semibold text-on-surface-variant"
                    htmlFor="checklist-title"
                  >
                    Title
                  </label>
                  <input
                    id="checklist-title"
                    className="w-full bg-surface border border-outline px-3 py-1.5 text-sm focus:ring-0 focus:border-primary focus:outline-none transition-all placeholder:text-surface-dim"
                    placeholder="e.g., Birds of Darjeeling"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-xs">
                  <label className="text-sm font-semibold text-on-surface-variant">
                    Taxonomic Scope
                  </label>
                  <TaxonomicScopeSelector
                    value={taxonomicScope}
                    onChange={(scope, taxonKey) => {
                      setTaxonomicScope(scope);
                      setDeepestTaxonKey(taxonKey);
                    }}
                    compact
                  />
                </div>

                <div className="space-y-xs">
                  <label className="text-sm font-semibold text-on-surface-variant">
                    Region
                  </label>
                  <RegionInput value={region} onChange={setRegion} compact />
                </div>
              </div>
            )}

            {step === 2 && (
              <SpeciesDiscoveryPanel
                taxonomicScope={taxonomicScope}
                deepestTaxonKey={deepestTaxonKey}
                region={region}
                uploadedFiles={uploadedFiles}
                onFilesAdded={(files) => setUploadedFiles((prev) => [...prev, ...files])}
                onRemoveFile={(index) => setUploadedFiles((prev) => prev.filter((_, i) => i !== index))}
                importIssues={importIssues}
                literatureRecords={literatureRecords}
                onAddLiterature={(records) => setLiteratureRecords((prev) => [...prev, ...records])}
                deepSearchRunId={deepSearchRunId}
                onDeepSearchRunIdChange={setDeepSearchRunId}
              />
            )}

            {step === 3 && (
              <div className="flex flex-col gap-3">                <SpeciesInventoryPanel
                  taxonomicScope={taxonomicScope}
                  deepestTaxonKey={deepestTaxonKey}
                  region={region}
                  selected={discoverySelection}
                  onSelectionChange={setDiscoverySelection}
                  onInventoryLoaded={setDiscoveryTotals}
                  uploadedRows={csvRows}
                  literatureRecords={literatureRecords}
                />
              </div>
            )}

            {step === 4 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-bold text-on-surface">
                  Add Collaborators
                </h2>
                <p className="text-xs text-on-surface-variant">
                  Add people by email. If they already have a Checklist Hub account, they&apos;ll
                  get access right away — if not, we&apos;ll email them an invite to join.
                </p>

                <div className="flex gap-2 relative">
                  <input
                    className="flex-1 border border-outline-variant bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
                    placeholder="Search by name or email…"
                    type="text"
                    value={collaboratorEmail}
                    onChange={(e) => {
                      setCollaboratorEmail(e.target.value);
                      setCollaboratorSuggestionsOpen(true);
                    }}
                    onFocus={() => setCollaboratorSuggestionsOpen(true)}
                    onBlur={() => setCollaboratorSuggestionsOpen(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCollaborator();
                      }
                    }}
                  />
                  {collaboratorSuggestionsOpen &&
                    ((collaboratorSuggestions?.length ?? 0) > 0 || showNewCollaboratorEmailRow) && (
                    <div className="absolute top-full left-0 mt-1 w-72 max-h-48 overflow-y-auto bg-white border border-outline-variant shadow-hard z-10">
                      {collaboratorSuggestions?.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left px-4 py-2 text-sm hover:bg-surface-container-low flex flex-col"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setCollaboratorEmail(p.email ?? "");
                            setCollaboratorSuggestionsOpen(false);
                          }}
                        >
                          <span>{p.full_name ?? "Unknown user"}</span>
                          {p.email && <span className="text-[11px] text-on-surface-variant">{p.email}</span>}
                        </button>
                      ))}
                      {showNewCollaboratorEmailRow && (
                        <button
                          type="button"
                          disabled={collaboratorLookupChecking || collaboratorLookupUnverified}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-surface-container-low flex items-center gap-2 border-t border-dashed border-outline-variant disabled:opacity-60 disabled:hover:bg-transparent"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            addCollaborator();
                          }}
                        >
                          <span className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant bg-surface-container-low px-1.5 py-0.5">
                            New
                          </span>
                          {collaboratorLookupChecking ? (
                            <span className="flex items-center gap-1.5 text-on-surface-variant">
                              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                              Checking <strong>{trimmedCollaboratorEmail}</strong>…
                            </span>
                          ) : collaboratorLookupUnverified ? (
                            <span className="text-on-surface-variant">
                              Couldn&apos;t find a mail server for <strong>{trimmedCollaboratorEmail}</strong>
                            </span>
                          ) : (
                            <span>
                              Invite <strong>{trimmedCollaboratorEmail}</strong> by email
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={addCollaborator}
                    disabled={
                      showNewCollaboratorEmailRow && (collaboratorLookupChecking || collaboratorLookupUnverified)
                    }
                    className="bg-primary text-on-primary px-4 py-2 font-label-caps text-[11px] hard-shadow disabled:opacity-50"
                  >
                    INVITE
                  </button>
                </div>

                {collaboratorInvites.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant">
                      Pending Invites
                    </span>
                    <ul className="flex flex-col gap-1.5">
                      {collaboratorInvites.map((invite) => (
                        <li
                          key={invite.email}
                          className="flex items-center justify-between border border-outline-variant bg-white px-3 py-2"
                        >
                          <span className="text-xs">{invite.email}</span>
                          <button
                            type="button"
                            onClick={() => removeCollaborator(invite.email)}
                            className="text-on-surface-variant hover:text-primary transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-bold text-on-surface">
                  Review &amp; Create
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="border border-outline-variant bg-white p-3 flex flex-col gap-2">
                    <span className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant">
                      Project Overview
                    </span>
                    <div>
                      <p className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">
                        Title
                      </p>
                      <p className="text-sm font-bold">{title || "—"}</p>
                    </div>
                    <div>
                      <p className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">
                        Region
                      </p>
                      <p className="text-sm">{region.region_name || "—"}</p>
                    </div>
                    <div>
                      <p className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">
                        Taxonomic Scope
                      </p>
                      <p className="text-sm">
                        {Object.values(taxonomicScope).filter(Boolean).join(" > ") || "—"}
                      </p>
                    </div>
                  </div>

                  <div className="border border-outline-variant bg-white p-3 flex flex-col gap-2">
                    <span className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant">
                      Data &amp; Team
                    </span>
                    <div>
                      <p className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">
                        Species to Import
                      </p>
                      <p className="text-sm font-bold">
                        {discoveryTotals?.totalSpecies ?? auditStats.totalSpecies} candidate species
                      </p>
                    </div>
                    <div>
                      <p className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">
                        Collaborators Invited
                      </p>
                      {collaboratorInvites.length > 0 ? (
                        <ul className="text-sm flex flex-col gap-0.5">
                          {collaboratorInvites.map((invite) => (
                            <li key={invite.email}>{invite.email}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm font-bold">—</p>
                      )}
                    </div>
                  </div>
                </div>

                {createChecklist.isError && (
                  <p className="text-xs text-red-600">
                    {(createChecklist.error as Error).message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer nav */}
        <div className="bg-surface-container-low border-t border-outline-variant px-6 py-4 flex justify-end gap-3 shrink-0">
          {step === 1 ? (
            <Link
              href="/checklists"
              onClick={() => void clearDraft()}
              className="px-5 py-1.5 font-label-caps text-[11px] text-on-surface-variant hover:text-primary transition-colors"
            >
              CANCEL
            </Link>
          ) : (
            <button
              type="button"
              onClick={goBack}
              className="px-5 py-1.5 font-label-caps text-[11px] text-on-surface-variant hover:text-primary transition-colors"
            >
              BACK
            </button>
          )}

          {step < 5 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue()}
              className="bg-primary text-on-primary px-6 py-1.5 font-label-caps text-[11px] hard-shadow disabled:opacity-50 hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
            >
              CONTINUE
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={createChecklist.isPending}
              className="bg-[#c63939] text-on-primary px-5 py-2 font-label-caps text-[11px] hard-shadow disabled:opacity-50 hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
            >
              {createChecklist.isPending ? "CREATING..." : "CREATE CHECKLIST"}
            </button>
          )}
        </div>
      </div>
      </div>

      {/* Rendered outside the dialog's backdrop-blur container — backdrop-filter
          on an ancestor establishes a new containing block for fixed-position
          descendants, which would make this drift with the dialog's scroll
          instead of staying fixed to the viewport. */}
      {showScrollHint && (
        <button
          type="button"
          onClick={scrollHintClick}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[110] flex flex-col items-center text-primary hover:opacity-75 transition-opacity animate-bounce"
          aria-label="Scroll down"
          title="Scroll down"
        >
          <span className="material-symbols-outlined text-[20px]">mouse</span>
          <span className="material-symbols-outlined text-[14px] -mt-1">keyboard_arrow_down</span>
        </button>
      )}
    </>
  );
}

