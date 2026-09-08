"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCreateChecklist } from "@/modules/checklist/hooks/useCreateChecklist";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { useProfile, useUpdateProfile } from "@/modules/auth/hooks/useProfile";
import { ChecklistTour, type TourStop } from "@/components/checklist-wizard/ChecklistTour";
import {
  PartialChecklistCreationError,
  resumeChecklistSpeciesImport,
  type CreateChecklistProgress,
} from "@/modules/checklist/services/checklistService";
import { useEmailLookup, useProfileSearch } from "@/modules/checklist/hooks/useChecklist";
import { isValidEmailFormat } from "@/lib/validation/email";
import {
  mergeParsedFiles,
  type ParsedFileResult,
  type ParsedSpeciesRow,
} from "@/modules/checklist/utils/speciesFileParser";
import type { CollaboratorInviteInput, TaxonomicScope } from "@/types/checklist.types";
import { buildScope, formatScopePath, isScopeUsable, scopeNodes, scopeSignature } from "@/lib/taxonomy/scopeNodes";
import { TaxonomicScopeSelector } from "@/components/checklist-wizard/step1/TaxonomicScopeSelector";
import { useTaxonomicScopeSuggestion } from "@/modules/taxonomy/hooks/useTaxonomicScopeSuggestion";
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

const TOUR_STOPS: TourStop[] = [
  {
    step: 1,
    title: "Start here",
    body: "Give your checklist a title, then set its taxonomic scope and region — e.g. “Birds of Darjeeling”.",
  },
  {
    step: 2,
    title: "Add species",
    body: "Search automatically for species matching your scope, or upload your own CSV file.",
  },
  {
    step: 3,
    title: "Review & validate",
    body: "Check the discovered species and pick which ones you want to include in the checklist.",
  },
  {
    step: 4,
    title: "Bring in your team",
    body: "Invite collaborators by email — they get access right away, or an invite if they're new here.",
  },
  {
    step: 5,
    title: "You're ready",
    body: "Review the summary, then hit Create Checklist to publish your species list and start collaborating.",
  },
];

/**
 * Renders a scope as a wrapping breadcrumb (e.g. Animalia › Arthropoda ›
 * Lepidoptera) instead of a truncated bracketed string. Excluded taxa are
 * appended struck-through, since "Lepidoptera without Papilionoidea" is a
 * different scope from "Lepidoptera" and the difference has to be visible.
 */
function ScopeBreadcrumb({ classification }: { classification: TaxonomicScope }) {
  const nodes = scopeNodes(classification);
  const included = nodes.filter((n) => n.mode === "include");
  const excluded = nodes.filter((n) => n.mode === "exclude");
  return (
    <span className="flex flex-wrap items-center text-on-surface-variant ">
      {included.map((node, i) => (
        <span key={`${node.rank}-${node.name}`} className="flex items-center">
          {i > 0 && <span className="material-symbols-outlined scale-75">chevron_right</span>}
          {node.name}
        </span>
      ))}
      {excluded.map((node) => (
        <span key={`x-${node.rank}-${node.name}`} className="flex items-center ml-1 text-red-700">
          <span className="material-symbols-outlined scale-75">block</span>
          <span className="line-through">{node.name}</span>
        </span>
      ))}
    </span>
  );
}

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
  const { data: currentUser } = useCurrentUser();
  const { data: profile } = useProfile(currentUser?.id);
  const updateProfile = useUpdateProfile(currentUser?.id);
  // Optimistic local flag so the tour disappears the instant the user skips
  // or finishes it, without waiting on the profile refetch that follows the
  // mutation below.
  const [tourDismissedLocally, setTourDismissedLocally] = useState(false);
  const showTour = Boolean(profile) && !profile?.has_seen_checklist_tour && !tourDismissedLocally;
  function endTour() {
    setTourDismissedLocally(true);
    if (currentUser?.id) updateProfile.mutate({ has_seen_checklist_tour: true });
  }
  const tourStep1Ref = useRef<HTMLDivElement>(null);
  const tourStep2Ref = useRef<HTMLDivElement>(null);
  const tourStep3Ref = useRef<HTMLDivElement>(null);
  const tourStep4Ref = useRef<HTMLDivElement>(null);
  const tourCreateButtonRef = useRef<HTMLButtonElement>(null);
  const [creationProgress, setCreationProgress] = useState<CreateChecklistProgress | null>(null);
  // Set when the checklist itself was created but appending its species failed
  // partway — the checklist is NOT lost, so the UI offers a resume instead of
  // implying the whole thing failed and needs to be redone from scratch.
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Mirrors DraftMeta.pendingCreation — persisted so that a hard refresh or a
  // dropped connection mid-import doesn't strand the user on a near-empty
  // checklist with no way back: on reload we detect this and resume the same
  // import instead of restarting the wizard or losing track of it.
  const [pendingCreation, setPendingCreation] = useState<{ checklistId: string; total: number } | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  // True ONLY when pendingCreation came from a draft restored on mount (i.e.
  // a previous attempt was interrupted by a reload/closed tab/dropped
  // connection) — NOT when pendingCreation is set live during this session's
  // own handleCreate (which updates it on every progress tick so it can be
  // persisted). Without this separate flag, the auto-resume effect below
  // would also fire right after an in-session partial failure — the moment
  // createChecklist.isPending flips back to false — racing with the manual
  // "RETRY REMAINING SPECIES" button and forcing the user to Step 5.
  const [autoResumePending, setAutoResumePending] = useState(false);
  // Snapshot of the persisted species list as of the last reload — see the
  // comment where this is populated (in the draft-restore effect) for why the
  // resume path uses this instead of live mergedRows.
  const restoredSpeciesRef = useRef<ParsedSpeciesRow[] | null>(null);

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

  const [dismissedSuggestionTerm, setDismissedSuggestionTerm] = useState<string | null>(null);
  const scopeSuggestion = useTaxonomicScopeSuggestion(title);
  const suggestedScope =
    scopeSuggestion.data && !isScopeUsable(taxonomicScope) && dismissedSuggestionTerm !== scopeSuggestion.data.matchedTerm
      ? scopeSuggestion.data
      : null;

  /**
   * Apply a suggestion wholesale. The route returns fully-formed scope nodes
   * with their GBIF keys already resolved (see scopeGbifBridge.server.ts), so
   * unlike the old flat-classification path there is nothing left to look up
   * here — including for suggestions that reach a rank GBIF has no taxa at,
   * where no single key exists to look up in the first place.
   */
  function applyScopeSuggestion() {
    if (!suggestedScope?.nodes?.length) return;
    const scope = buildScope(suggestedScope.nodes, suggestedScope.enabledRanks ?? []);
    setTaxonomicScope(scope);
    const deepest = [...(scope.nodes ?? [])].filter((n) => n.mode === "include" && n.gbifKey).pop();
    setDeepestTaxonKey(deepest?.gbifKey ?? null);
  }

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
        if (meta.pendingCreation) {
          setPendingCreation(meta.pendingCreation);
          setAutoResumePending(true);
        }
      }
      // The draft only persists the already-merged rows/issues, not the
      // original per-file breakdown — restore as one removable entry rather
      // than losing the data entirely.
      if (storedCsvRows.length > 0) {
        setUploadedFiles([
          { fileName: meta?.csvFileName || "Restored upload", rows: storedCsvRows, issues: storedIssues },
        ]);
      }
      // mergedRows is normally recomputed from csvRows + discoverySelection, but
      // the restored `species` snapshot (persisted whenever mergedRows last
      // changed, pre-reload) is kept here as the source of truth for a pending
      // resume specifically: the scope/region-change effect further down resets
      // discoverySelection back to empty the moment a restored scope/region
      // first differs from the wizard's defaults (true for any real draft past
      // Step 1), which would otherwise make a recomputed mergedRows silently
      // miss anything sourced from Step 2/3's discovery panel right when the
      // auto-resume effect needs the complete list.
      restoredSpeciesRef.current = species;
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
      pendingCreation,
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
    pendingCreation,
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
  // Keyed on the whole scope rather than just the deepest GBIF key: adding or
  // removing an exclusion changes which species belong without changing that
  // key at all, and stale selections would otherwise survive it.
  const scopeKey = `${scopeSignature(taxonomicScope)}|${region.region_gadm_id}`;
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
    if (step === 1) {
      return (
        title.trim().length > 0 &&
        isScopeUsable(taxonomicScope) &&
        Boolean(region.region_district || region.region_state || region.region_country) &&
        Boolean(region.region_gadm_id)
      );
    }
    return true;
  }

  function goNext() {
    if (step < 5) setStep(step + 1);
  }

  function goBack() {
    if (step > 1) setStep(step - 1);
  }

  const partialError =
    createChecklist.error instanceof PartialChecklistCreationError ? createChecklist.error : null;
  // True the moment the checklist row exists but its species import hasn't
  // been confirmed complete yet — covers the initial attempt, a manual retry
  // after a partial failure, and an auto-resume after reload.
  const importInFlight = createChecklist.isPending || retrying || resuming;

  // Warn before an accidental refresh/close while species are actively being
  // imported — most browsers ignore the custom message and show their own
  // generic prompt, but the prompt itself is the point here.
  useEffect(() => {
    if (!importInFlight) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [importInFlight]);

  // If a previous attempt left the checklist created but its import
  // unfinished (reload, dropped connection, closed tab), resume it
  // automatically once the draft has loaded, instead of leaving the user
  // stuck on a near-empty checklist with no path forward.
  useEffect(() => {
    if (!draftLoaded || !autoResumePending || !pendingCreation || resuming) return;
    const checklistId = pendingCreation.checklistId;
    // Use the species snapshot captured at restore time, not live mergedRows
    // — see restoredSpeciesRef's declaration for why (the scope/region-reset
    // effect below can otherwise wipe discoverySelection, and therefore
    // mergedRows, right after a restore).
    const speciesToResume = restoredSpeciesRef.current ?? mergedRows;
    // Deferred to a microtask so this effect's synchronous body never calls
    // setState directly (avoids cascading-render churn) — the resume itself
    // is still kicked off as soon as this effect runs. Clearing
    // autoResumePending here (not after the resume settles) ensures this
    // effect can never fire a second time for the same restored draft, even
    // if pendingCreation's object identity changes again later for other
    // reasons (e.g. a subsequent live handleCreate call this session).
    void Promise.resolve()
      .then(() => {
        setAutoResumePending(false);
        setStep(5);
        setResuming(true);
        setResumeError(null);
        return resumeChecklistSpeciesImport(checklistId, speciesToResume, setCreationProgress);
      })
      .then(() => {
        setPendingCreation(null);
        void clearDraft();
        router.push(`/checklists/${checklistId}`);
      })
      .catch((err: unknown) => {
        setResumeError(err instanceof Error ? err.message : "Failed to finish adding species.");
      })
      .finally(() => setResuming(false));
    // mergedRows deliberately excluded — speciesToResume is captured once
    // above from the ref, so recomputes of mergedRows itself (e.g. as
    // discoverySelection/csvRows settle after restore) must not restart the
    // resume mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoaded, autoResumePending, pendingCreation, resuming]);

  async function handleRetryRemaining() {
    const target = partialError ?? pendingCreation;
    if (!target) return;
    // A live in-session partial failure (partialError set) has an intact,
    // up-to-date mergedRows — use it directly. A retry after a FAILED
    // auto-resume (partialError absent, falling back to pendingCreation) is
    // only reachable post-reload, where mergedRows may have been recomputed
    // from a discoverySelection the scope/region-reset effect already wiped
    // — prefer the stable restore-time snapshot there instead.
    const speciesToRetry = partialError ? mergedRows : restoredSpeciesRef.current ?? mergedRows;
    setRetrying(true);
    setRetryError(null);
    try {
      await resumeChecklistSpeciesImport(target.checklistId, speciesToRetry, setCreationProgress);
      setPendingCreation(null);
      void clearDraft();
      router.push(`/checklists/${target.checklistId}`);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Failed to add the remaining species.");
    } finally {
      setRetrying(false);
    }
  }

  function handleCreate() {
    setCreationProgress(null);
    setRetryError(null);
    createChecklist.mutate(
      {
        input: {
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
        // Persist the checklist id the moment it exists (first progress
        // callback), before the whole call resolves — see pendingCreation.
        onProgress: (progress) => {
          setCreationProgress(progress);
          setPendingCreation({ checklistId: progress.checklistId, total: progress.total });
        },
      },
      {
        onSuccess: (checklist) => {
          setPendingCreation(null);
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
              onClick={(e) => {
                if (importInFlight) {
                  e.preventDefault();
                  return;
                }
                void clearDraft();
              }}
              aria-disabled={importInFlight}
              className="material-symbols-outlined text-[18px] text-on-surface-variant hover:text-primary absolute right-0 top-0 aria-disabled:opacity-50 aria-disabled:pointer-events-none"
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
              <div ref={tourStep1Ref} className="flex flex-col gap-3">
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
                  {suggestedScope && (
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs bg-surface-container-low/60 border border-outline-variant/40 px-2 py-1.5">
                      <span className="text-on-surface-variant">Suggested from title:</span>
                      <span className="font-semibold text-primary gap-y-2 capitalize">{suggestedScope.matchedTerm}</span>
                      <ScopeBreadcrumb classification={suggestedScope.classification} />
                      <div className="flex items-center gap-1 ml-auto">
                        <button
                          type="button"
                          onClick={applyScopeSuggestion}
                          className="shrink-0 font-label-caps uppercase tracking-wider text-[10px] text-primary border border-primary/40 bg-primary-container/20 hover:bg-primary-container/40 px-2 py-0.5 rounded-sm transition-colors"
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          onClick={() => setDismissedSuggestionTerm(suggestedScope.matchedTerm)}
                          className="shrink-0 material-symbols-outlined text-[14px] text-on-surface-variant hover:text-primary"
                          aria-label="Dismiss scope suggestion"
                        >
                          close
                        </button>
                      </div>
                      {suggestedScope.note && (
                        <p className="basis-full text-[11px] text-on-surface-variant/80 italic">
                          {suggestedScope.note}
                        </p>
                      )}
                    </div>
                  )}
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
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-semibold text-on-surface-variant">
                      Region
                    </label>
                    {region.region_gadm_id && (
                      <span className="text-sm font-semibold text-primary">{region.region_gadm_id}</span>
                    )}
                  </div>
                  <RegionInput value={region} onChange={setRegion} compact />
                </div>
              </div>
            )}

            {step === 2 && (
              <div ref={tourStep2Ref}>
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
              </div>
            )}

            {step === 3 && (
              <div ref={tourStep3Ref} className="flex flex-col gap-3">                <SpeciesInventoryPanel
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
              <div ref={tourStep4Ref} className="flex flex-col gap-3">
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
                        {formatScopePath(taxonomicScope, " > ") || "—"}
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

                {importInFlight && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold text-[#c63939]">
                      {resuming
                        ? "Resuming your checklist — please don't close or refresh this tab."
                        : "Please don't close or refresh this tab while your checklist is being created."}
                    </p>

                    {!creationProgress ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs text-on-surface-variant">
                          <span>Resolving taxonomy and creating checklist…</span>
                        </div>
                        <div className="h-1.5 w-full bg-outline-variant/40 rounded-full overflow-hidden">
                          <div className="h-full w-1/3 bg-primary animate-pulse" />
                        </div>
                      </div>
                    ) : (
                      creationProgress.total > 0 && (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-xs text-on-surface-variant">
                            <span>
                              {creationProgress.completed < creationProgress.total
                                ? `Adding species to checklist… ${creationProgress.completed.toLocaleString()} / ${creationProgress.total.toLocaleString()}`
                                : "Finalizing checklist…"}
                            </span>
                            <span className="mono-text">
                              {Math.round((creationProgress.completed / creationProgress.total) * 100)}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-outline-variant/40 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-300"
                              style={{
                                width: `${Math.min(100, (creationProgress.completed / creationProgress.total) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}

                {!importInFlight && resumeError && (
                  <div className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-3">
                    <p className="text-xs text-red-700">
                      Resuming your checklist failed: {resumeError}. It still exists with{" "}
                      {creationProgress?.completed.toLocaleString() ?? 0} of{" "}
                      {(pendingCreation?.total ?? creationProgress?.total ?? 0).toLocaleString()} species added so far.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleRetryRemaining()}
                        className="self-start bg-[#c63939] text-on-primary px-4 py-1.5 font-label-caps text-[11px] hard-shadow hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
                      >
                        RETRY REMAINING SPECIES
                      </button>
                      {pendingCreation && (
                        <Link
                          href={`/checklists/${pendingCreation.checklistId}`}
                          onClick={() => void clearDraft()}
                          className="text-xs text-on-surface-variant hover:text-primary underline"
                        >
                          Go to checklist as-is
                        </Link>
                      )}
                    </div>
                  </div>
                )}

                {createChecklist.isError && partialError && (
                  <div className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-3">
                    <p className="text-xs text-red-700">
                      The checklist was created, but adding species stopped partway ({partialError.completedAtLeast.toLocaleString()}
                      {" "}of {partialError.total.toLocaleString()} confirmed so far): {partialError.message}
                    </p>
                    {retryError && <p className="text-xs text-red-700">Retry failed: {retryError}</p>}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleRetryRemaining()}
                        disabled={retrying}
                        className="self-start bg-[#c63939] text-on-primary px-4 py-1.5 font-label-caps text-[11px] hard-shadow disabled:opacity-50 hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
                      >
                        {retrying ? "RETRYING..." : "RETRY REMAINING SPECIES"}
                      </button>
                      <Link
                        href={`/checklists/${partialError.checklistId}`}
                        onClick={() => void clearDraft()}
                        className="text-xs text-on-surface-variant hover:text-primary underline"
                      >
                        Go to checklist as-is
                      </Link>
                    </div>
                  </div>
                )}

                {createChecklist.isError && !partialError && (
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
              onClick={(e) => {
                if (importInFlight) {
                  e.preventDefault();
                  return;
                }
                void clearDraft();
              }}
              aria-disabled={importInFlight}
              className="px-5 py-1.5 font-label-caps text-[11px] text-on-surface-variant hover:text-primary transition-colors aria-disabled:opacity-50 aria-disabled:pointer-events-none"
            >
              CANCEL
            </Link>
          ) : (
            <button
              type="button"
              onClick={goBack}
              disabled={importInFlight}
              className="px-5 py-1.5 font-label-caps text-[11px] text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50"
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
              ref={tourCreateButtonRef}
              type="button"
              onClick={handleCreate}
              // pendingCreation alone (beyond importInFlight) blocks this once a
              // checklist already exists un-confirmed-complete (a live partial
              // failure or a failed auto-resume) — otherwise clicking it here
              // would POST a brand-new checklist, leaving a duplicate alongside
              // the stuck one instead of retrying/finishing it via the banner above.
              disabled={importInFlight || !!pendingCreation}
              className="bg-[#c63939] text-on-primary px-5 py-2 font-label-caps text-[11px] hard-shadow disabled:opacity-50 hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
            >
              {importInFlight
                ? creationProgress && creationProgress.total > 0
                  ? `${resuming ? "RESUMING" : "CREATING"}… (${creationProgress.completed}/${creationProgress.total})`
                  : resuming
                    ? "RESUMING..."
                    : "CREATING..."
                : "CREATE CHECKLIST"}
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

      {showTour && (
        <ChecklistTour
          step={step}
          stops={TOUR_STOPS}
          targets={{
            1: tourStep1Ref,
            2: tourStep2Ref,
            3: tourStep3Ref,
            4: tourStep4Ref,
            5: tourCreateButtonRef,
          }}
          onSkip={endTour}
          onFinish={endTour}
        />
      )}
    </>
  );
}

