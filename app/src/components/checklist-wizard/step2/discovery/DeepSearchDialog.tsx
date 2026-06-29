"use client";

import { useEffect, useRef, useState } from "react";
import { useDeepSearch } from "@/modules/research/hooks/useDeepSearch";
import { useContribution } from "@/modules/research/hooks/useContribution";
import { setDocumentExcluded, excludeReviewCandidate, continueDeepSearch } from "@/modules/research/services/deepSearchService";
import { toLiteratureRecords } from "@/modules/research/services/literatureCandidatePool";
import type { RawSpeciesRecord } from "@/modules/evidence/discovery/types";
import type {
  DeepSearchDocument,
  DeepSearchPhase,
  DeepSearchResults,
  DeepSearchSpecies,
  ManualContribution,
  ReviewCandidate,
} from "@/modules/research/services/deepSearchService";

/** "list our above 70 relevance" — mirrors research-pipeline's REVIEW_SCORE_THRESHOLD; kept in sync manually since the two projects don't share imports (see research-pipeline/README.md). */
const REVIEW_SCORE_THRESHOLD = 70;

/** Default Scholar/curated-web/Crossref/OpenAlex results-per-query — no longer user-configurable, the run auto-starts on open. */
const DEFAULT_RESULTS_PER_QUERY = 20;

interface DeepSearchDialogProps {
  region: string;
  taxonGroup: string;
  onClose: () => void;
  /** Pushes this run's extracted species into the candidate species pool (Step 2/3), under source: "literature" — see toLiteratureRecords. */
  onAdd: (records: RawSpeciesRecord[]) => void;
  /** The in-flight/completed run's id, owned by the wizard page (and persisted to the draft) so closing this dialog — even accidentally — or navigating away and back resumes polling the same run instead of starting a new one. Null before any run has been started for this region/taxon. */
  runId: string | null;
  onRunIdChange: (runId: string | null) => void;
}

/**
 * The backend tracks ~10 granular phases (see research-pipeline's
 * RunPhase) for diagnostics, but that's too much for a user-facing
 * progress view — grouped down to 4 visual steps. "starting" gets its own
 * step (rather than being folded into "Discovering Literature") since it
 * covers spawning the detached research-pipeline process itself — a
 * distinct, sometimes-slow wait before any actual source querying starts.
 * "gbif_enrichment" (research-pipeline's analysis/gbifEnrichment.ts —
 * no-LLM GBIF backbone enrichment: common name, classification, synonym
 * resolution of the already-extracted species list) gets its own
 * "Mapping to Backbone" step rather than being folded into "Extracting
 * Species List", since it's a conceptually distinct pass over already-
 * extracted species. Everything after it (catalog, the final review pass,
 * wiki/outputs) still runs as one merged near-instant tail on the backend
 * (research-pipeline's pipeline/runPipeline.ts) — those stay folded into
 * "Mapping to Backbone" staying active until "done", since none of them
 * reflect anything the user can meaningfully watch happen separately.
 * Every RunPhase value must map to one of these 4 indices. "awaiting_review"
 * is deliberately mapped here too (TS requires every phase have an entry)
 * but is never actually rendered through this stepper — see the phase ===
 * "awaiting_review" branch below, which replaces the whole stepper with the
 * review-gate screen.
 */
const STEP_LABELS = ["Starting Pipeline", "Discovering Literature", "Extracting Species List", "Mapping to Backbone"] as const;

const PHASE_TO_STEP: Record<DeepSearchPhase, number> = {
  starting: 0,
  discovery: 1,
  enrichment: 1,
  citation_expansion: 1,
  ranking: 1,
  awaiting_review: 1,
  fulltext: 2,
  ecology: 2,
  gbif_enrichment: 3,
  catalog: 3,
  review: 3,
  wiki: 3,
  outputs: 3,
  done: 3,
  error: 0,
};

const DOCUMENT_TYPE_LABELS: Record<DeepSearchDocument["documentType"], string> = {
  checklist: "Literature",
  scientific_paper: "Scientific Paper",
  other: "Other / Grey Lit.",
};

/**
 * Triggers and shows progress/results for a research-pipeline deep-search
 * run. This is additive and read-only: it does not touch the existing
 * CSV-upload species-inventory flow and never writes to Supabase — see
 * research-pipeline/README.md "Design notes." Follows this codebase's
 * existing hand-rolled modal convention (no Dialog library) — see
 * AddSpeciesDialog.tsx/SettingsModal.tsx.
 */
export function DeepSearchDialog({ region, taxonGroup, onClose, onAdd, runId, onRunIdChange }: DeepSearchDialogProps) {
  const { start, isStarting, status, results, reviewCandidates, pollError, refetch } = useDeepSearch(runId, onRunIdChange);
  const [showContribute, setShowContribute] = useState(false);
  const [showDiscoveryList, setShowDiscoveryList] = useState(false);
  const [added, setAdded] = useState(false);

  function handleAdd(records: RawSpeciesRecord[]) {
    onAdd(records);
    setAdded(true);
    onClose();
  }

  // Starts a brand-new run for this region/taxon (discarding the current
  // one's runId via onRunIdChange in useDeepSearch's start.onSuccess) —
  // this is "Refresh": re-discover literature, not re-process what's
  // already been found. It only ever triggers the discovery step: the
  // pipeline always pauses at "awaiting_review" after discovery+ranking,
  // before any full-text fetch/extraction work, and only the explicit
  // "Continue" click in ReviewGate advances it further — so a fresh run
  // can never silently run past discovery on its own.
  function handleRefresh() {
    setAdded(false);
    start(region, taxonGroup, DEFAULT_RESULTS_PER_QUERY);
  }

  useEffect(() => {
    // Only auto-starts the first time this region/taxon has no run yet —
    // reopening the dialog (or navigating back to Step 2) with an existing
    // runId resumes polling that run instead of starting a duplicate one.
    if (runId === null) start(region, taxonGroup, DEFAULT_RESULTS_PER_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = status?.phase ?? "starting";
  const isDone = phase === "done";

  // "Extracting Species List" (step index 2) should read as done the
  // instant every queued paper has actually been read/extracted — not only
  // once the backend's phase string itself flips to "gbif_enrichment" on
  // the next 3s poll, which visibly lags the counts already shown in the
  // "X / Y literature read" sub-row right below it.
  const extractionCaughtUp =
    phase === "fulltext" &&
    (status?.counts.totalToAnalyze ?? 0) > 0 &&
    (status?.counts.papersRead ?? 0) >= (status?.counts.totalToAnalyze ?? 0);
  const currentStep = extractionCaughtUp ? PHASE_TO_STEP.gbif_enrichment : PHASE_TO_STEP[phase];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">
            Deep Literature Search — {taxonGroup} in {region}
          </h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isStarting}
              title="Restart discovery to look for new literature for this region/taxon — does not re-run full-text extraction on what's already been found; the pipeline pauses for review right after discovery, same as any run."
              className="mono-text text-[10px] font-bold uppercase px-3 py-1.5 rounded-sm border border-outline-variant hover:bg-surface-container-low disabled:opacity-50 flex items-center gap-1"
            >
              <span className={`material-symbols-outlined text-[14px] ${isStarting ? "animate-spin" : ""}`}>refresh</span>
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowContribute(true)}
              className="mono-text text-[10px] font-bold uppercase px-3 py-1.5 rounded-sm border border-outline-variant hover:bg-surface-container-low flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[14px]">upload_file</span>
              Add Paper Manually
              {results && results.manualContributions.length > 0 && (
                <span className="text-on-surface-variant">({results.manualContributions.length})</span>
              )}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-brand">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {pollError && <p className="text-xs text-red-600 mb-4">{pollError.message}</p>}

        {phase === "error" ? (
          <p className="text-xs text-red-600">{status?.error ?? "The run failed."}</p>
        ) : phase === "awaiting_review" ? (
          <ReviewGate
            runId={runId as string}
            candidates={reviewCandidates ?? []}
            counts={status?.counts ?? {}}
            onRefetch={refetch}
          />
        ) : phase !== "done" ? (
          <div className="flex flex-col gap-1.5 pl-4 border-l-2 border-outline-variant/40 ml-1">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex flex-col gap-1.5">
                <PhaseRow
                  label={label}
                  state={i < currentStep ? "done" : i === currentStep ? "active" : "pending"}
                  onClick={label === "Discovering Literature" ? () => setShowDiscoveryList((v) => !v) : undefined}
                  expanded={label === "Discovering Literature" ? showDiscoveryList : undefined}
                />
                {label === "Discovering Literature" && showDiscoveryList && (
                  <DiscoveredLiteraturePanel candidates={reviewCandidates ?? []} runId={runId} onExcluded={refetch} />
                )}
              </div>
            ))}
            {(phase === "discovery" || phase === "enrichment" || phase === "citation_expansion") && (
              <p className="font-code-md text-[12px] text-on-surface-variant pl-3">
                Searching sources…
                {status?.counts.papersDiscovered ? ` [${status.counts.papersDiscovered} literature found]` : ""}
              </p>
            )}
            {phase === "ranking" && (
              <p className="font-code-md text-[12px] text-on-surface-variant pl-3">
                Ranking {status?.counts.papersDiscovered ?? 0} literature by relevance…
              </p>
            )}
            {phase === "fulltext" && (
              <>
                <ProgressSubRow
                  label="Literature read & species extracted"
                  current={status?.counts.papersRead ?? 0}
                  total={status?.counts.totalToAnalyze ?? 0}
                />
                <p className="font-code-md text-[12px] text-on-surface-variant pl-3">
                  {status?.counts.speciesFound ?? 0} species found so far
                </p>
              </>
            )}
          </div>
        ) : (
          <ResultsView results={results} onDocumentExcluded={refetch} onAdd={handleAdd} added={added} />
        )}

        {phase !== "awaiting_review" && (
          <div className="flex items-center justify-end gap-2 mt-6">
            <button
              onClick={onClose}
              className="mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm border border-surface-dim hover:bg-surface-container-low"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {showContribute && (
        <ContributeDialog
          region={region}
          taxonGroup={taxonGroup}
          contributions={results?.manualContributions ?? []}
          onChanged={isDone ? () => refetch() : undefined}
          onClose={() => setShowContribute(false)}
        />
      )}
    </div>
  );
}

/**
 * Header-button-triggered dialog (layered above the main results dialog)
 * for manually contributing a paper, ingested through the same analysis
 * pipeline as discovered literature (tagged discoveredVia: "manual" — see
 * research-pipeline/src/discovery/manualContribution.ts). Splits drag-drop
 * and paste-link into separate sections (rather than one combined drop
 * zone), lists every contribution made so far with its own extracted
 * species and a remove control, and flags — but never auto-removes —
 * contributions that don't look like they're actually about this
 * region/taxon (possiblyOffRegion/possiblyWrongTaxon, computed server-side
 * the same way as the discovered-documents table).
 */
function ContributeDialog({
  region,
  taxonGroup,
  contributions,
  onChanged,
  onClose,
}: {
  region: string;
  taxonGroup: string;
  contributions: ManualContribution[];
  onChanged?: () => void;
  onClose: () => void;
}) {
  // Overlays the `contributions` prop (sourced from results, only refreshed
  // by a parent refetch) with optimistic adds/removes from this dialog's own
  // mutations, so the list updates immediately rather than waiting on the
  // next poll — merged at render time (not via an effect+setState, which
  // would cause an extra cascading render for no benefit here).
  const [addedOverlay, setAddedOverlay] = useState<ManualContribution[]>([]);
  const [removedSlugs, setRemovedSlugs] = useState<Set<string>>(new Set());
  const [url, setUrl] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const localContributions = [...addedOverlay, ...contributions.filter((c) => !addedOverlay.some((a) => a.slug === c.slug))].filter(
    (c) => !removedSlugs.has(c.slug),
  );

  const {
    contributeUrl,
    contributeFile,
    removeContribution,
    isContributing,
    isRemoving,
    contributionError,
    contributionSucceeded,
    reset,
  } = useContribution(
    region,
    taxonGroup,
    (entry) => {
      setAddedOverlay((prev) => [entry, ...prev.filter((c) => c.slug !== entry.slug)]);
      onChanged?.();
    },
    (slug) => {
      setRemovedSlugs((prev) => new Set(prev).add(slug));
      onChanged?.();
    },
  );

  function handleUrlSubmit() {
    if (!url.trim()) return;
    contributeUrl(url.trim(), { onSuccess: () => setUrl("") });
  }

  function handleFiles(files: File[]) {
    const file = files[0];
    if (file) contributeFile(file);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Add Paper Manually</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              handleFiles(Array.from(e.dataTransfer.files ?? []));
            }}
            className={`border-2 border-dashed bg-white flex flex-col items-center justify-center gap-1.5 py-6 px-3 cursor-pointer transition-colors ${
              isDragOver ? "border-primary" : "border-outline-variant hover:border-primary"
            }`}
          >
            <span className="material-symbols-outlined text-on-surface-variant text-[28px]">upload_file</span>
            <p className="text-xs text-on-surface-variant text-center">
              {isContributing ? "Adding…" : "Drag and drop a PDF here, or click to browse"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                handleFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          <div className="border border-outline-variant bg-white flex flex-col items-center justify-center gap-1.5 py-6 px-3">
            <span className="material-symbols-outlined text-on-surface-variant text-[28px]">link</span>
            <p className="text-xs text-on-surface-variant text-center">Or paste a DOI / PDF link</p>
            <div className="flex items-center gap-2 w-full max-w-xs">
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (contributionSucceeded || contributionError) reset();
                }}
                placeholder="https://doi.org/..."
                className="flex-1 text-xs border border-outline-variant rounded-sm px-2 py-1.5 bg-white"
              />
              <button
                type="button"
                onClick={handleUrlSubmit}
                disabled={isContributing || !url.trim()}
                className="mono-text text-[10px] font-bold uppercase px-3 py-1.5 rounded-sm border border-outline-variant hover:bg-surface-container-low disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {contributionError && <p className="text-xs text-red-600 mb-3">{contributionError.message}</p>}
        {contributionSucceeded && <p className="text-xs text-green-700 mb-3">Added to the corpus.</p>}

        <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
          Uploaded Papers ({localContributions.length})
        </h4>
        {localContributions.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No manually-contributed papers yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {localContributions.map((c) => (
              <ContributionRow key={c.slug} contribution={c} onRemove={() => removeContribution(c.slug)} disabled={isRemoving} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContributionRow({
  contribution,
  onRemove,
  disabled,
}: {
  contribution: ManualContribution;
  onRemove: () => void;
  disabled: boolean;
}) {
  const warning = contribution.possiblyOffRegion && contribution.possiblyWrongTaxon
    ? "Wrong region and wrong taxon — flagged, not removed"
    : contribution.possiblyOffRegion
      ? "Doesn't appear to be about this region — flagged, not removed"
      : contribution.possiblyWrongTaxon
        ? "Doesn't appear to be about this taxon — flagged, not removed"
        : undefined;

  return (
    <details className="border border-outline-variant rounded-sm">
      <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-2 select-none">
        <span className="text-xs text-on-surface flex items-center gap-1 min-w-0">
          {warning && (
            <span title={warning} className="text-amber-600">
              ⚠
            </span>
          )}
          <span className="truncate">
            {contribution.title}
            {contribution.year && <span className="text-on-surface-variant"> ({contribution.year})</span>}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-on-surface-variant text-[10px]">{contribution.species.length} species</span>
          {contribution.link && (
            <a
              href={contribution.link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:text-brand inline-flex items-center"
            >
              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            </a>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault();
              onRemove();
            }}
            title="Remove this contribution"
            className="text-on-surface-variant hover:text-red-600 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </span>
      </summary>
      <div className="px-3 pb-3">
        {contribution.species.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No species extracted from this paper yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {contribution.species.map((sp) => (
              <li key={sp.scientificName} className="text-xs text-on-surface flex items-center gap-1">
                <span className="italic">{sp.scientificName}</span>
                {sp.commonName && <span className="text-on-surface-variant"> — {sp.commonName}</span>}
                {sp.backboneValidated && (
                  <span title="Confirmed against the GBIF backbone taxonomy" className="text-green-600 text-[12px]">
                    ✓
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function PhaseRow({
  label,
  state,
  onClick,
  expanded,
}: {
  label: string;
  state: "done" | "active" | "pending";
  /** Makes this row clickable — e.g. "Discovering Literature" opens a live list of what's been found so far, even mid-run. Other steps stay non-interactive. */
  onClick?: () => void;
  expanded?: boolean;
}) {
  const icon = state === "done" ? "check_circle" : state === "active" ? "progress_activity" : "radio_button_unchecked";
  const iconClass =
    state === "done" ? "text-green-600" : state === "active" ? "text-primary animate-spin" : "text-on-surface-variant/40";
  const textClass = state === "pending" ? "text-on-surface-variant/60" : "text-on-surface";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex items-center gap-2 py-1.5 px-3 bg-surface border border-outline-variant/30 rounded-sm w-full text-left ${
        onClick ? "hover:bg-surface-container-low cursor-pointer" : "cursor-default"
      }`}
    >
      <span className={`material-symbols-outlined text-[16px] ${iconClass}`}>{icon}</span>
      <span className={`font-code-md text-[12px] ${textClass}`}>{label}</span>
      {onClick && (
        <span className="material-symbols-outlined text-[14px] text-on-surface-variant/60 ml-auto">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      )}
    </button>
  );
}

/**
 * Live view of what's actually been kept for analysis so far — opened by
 * clicking the "Discovering Literature" step, works at any phase (including
 * mid-run, before the review-candidates file even exists yet). Shows only
 * the SAME survivor set `runAnalysisPhase` will extract from (score >=
 * REVIEW_SCORE_THRESHOLD, not excluded) — the same filter ReviewGate's
 * `ranked` list uses — not the full raw discovery list, which also
 * contains candidates that were never going to reach extraction anyway and
 * just added noise. Excluding here uses the exact same
 * `excludeReviewCandidate` action as ReviewGate, so a candidate removed
 * here never reaches `runAnalysisPhase`'s survivors filter either.
 */
function DiscoveredLiteraturePanel({
  candidates,
  runId,
  onExcluded,
}: {
  candidates: ReviewCandidate[];
  runId: string | null;
  onExcluded: () => void;
}) {
  const [excludedSlugs, setExcludedSlugs] = useState<Set<string>>(new Set());
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const survivors = candidates.filter(
    (c) => !c.excluded && !excludedSlugs.has(c.slug) && c.score >= REVIEW_SCORE_THRESHOLD,
  );

  if (survivors.length === 0) {
    return (
      <p className="font-code-md text-[11px] text-on-surface-variant pl-3 py-1">
        {candidates.length === 0
          ? "Still searching — nothing discovered yet. This list fills in once the discovery phase finishes its first pass."
          : `None of the ${candidates.length} discovered so far cleared the relevance threshold (score ≥ ${REVIEW_SCORE_THRESHOLD}).`}
      </p>
    );
  }

  async function handleRemove(slug: string) {
    if (!runId) return;
    setPendingSlug(slug);
    try {
      await excludeReviewCandidate(runId, slug, true);
      setExcludedSlugs((prev) => new Set(prev).add(slug));
      onExcluded();
    } finally {
      setPendingSlug(null);
    }
  }

  const sorted = [...survivors].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto pl-3 py-1">
      {sorted.map((c) => (
        <DiscoveredLiteratureRow
          key={c.slug}
          candidate={c}
          pending={pendingSlug === c.slug}
          onRemove={() => handleRemove(c.slug)}
        />
      ))}
    </div>
  );
}

function DiscoveredLiteratureRow({
  candidate,
  pending,
  onRemove,
}: {
  candidate: ReviewCandidate;
  pending: boolean;
  onRemove: () => void;
}) {
  // This row only ever renders for a survivor (score >= threshold, not
  // excluded — see DiscoveredLiteraturePanel's filter), so the remaining
  // signal worth flagging here is region/taxon specificity itself: a
  // candidate can clear the OVERALL score threshold on strong taxon/
  // citability/species-record signal while still only weakly matching the
  // target region (or not at all) — exactly the real "Nainital/Uttarakhand
  // cleared a Darjeeling search" bug. Same 40-point cutoff DocumentsTable
  // already uses for `possiblyOffRegion`/`possiblyWrongTaxon`, so a
  // suspicious candidate is visibly flagged here too, not only after
  // full-text analysis already ran against it.
  const possiblyOffRegion = candidate.regionScore < 40;
  const possiblyWrongTaxon = candidate.taxonScore < 40;
  return (
    <div className="flex items-center gap-2 border border-outline-variant rounded-sm px-3 py-2">
      <div className="flex flex-col items-center justify-center w-10 shrink-0">
        <span className="font-code-md text-[13px] font-bold text-on-surface">{candidate.score}</span>
        <span className="font-label-caps text-[8px] text-on-surface-variant/70">SCORE</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-on-surface truncate">
          {(possiblyOffRegion || possiblyWrongTaxon) && (
            <span title="This candidate's overall score cleared the threshold, but its region/taxon match is weak — review before it reaches full-text analysis." className="text-red-600 mr-1">
              🚩
            </span>
          )}
          {candidate.title}
          {candidate.year && <span className="text-on-surface-variant"> ({candidate.year})</span>}
        </p>
        <p className="text-[10px] text-on-surface-variant flex items-center gap-1.5">
          <span>{DOC_TYPE_SHORT_LABELS[candidate.documentType]}</span>
          {possiblyOffRegion && <span className="text-red-600">⚠ weak/no match for the target region</span>}
          {possiblyWrongTaxon && <span className="text-red-600">⚠ weak/no match for the target taxon</span>}
        </p>
      </div>
      {candidate.link && (
        <a
          href={candidate.link}
          target="_blank"
          rel="noreferrer"
          title={candidate.link}
          className="text-primary hover:text-brand inline-flex items-center shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
        </a>
      )}
      <button
        type="button"
        disabled={pending || candidate.excluded}
        onClick={onRemove}
        title="Remove this paper — it will never reach full-text analysis or appear in this run's results."
        className="text-on-surface-variant hover:text-red-600 disabled:opacity-50 shrink-0"
      >
        <span className="material-symbols-outlined text-[16px]">delete</span>
      </button>
    </div>
  );
}

/** A thin live-updating sub-row under the active stepper row — "12 of 40 literature read", growing as Stage B's fulltext/llm_analysis counts update on each poll. Renders nothing useful (0/0) before the backend has written its first count, which is fine — it just looks like "0 of 0" for a beat. */
function ProgressSubRow({ label, current, total }: { label: string; current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="pl-3 pr-1 py-1 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-code-md text-[11px] text-on-surface-variant">{label}</span>
        <span className="font-code-md text-[11px] text-on-surface-variant">
          {current} / {total}
        </span>
      </div>
      <div className="h-1 w-full bg-surface-container-low rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * The "awaiting_review" pause screen — discovery + non-LLM ranking is done
 * (see research-pipeline's preliminaryRelevance.ts), full-text/LLM analysis
 * has NOT started. Lists only candidates at or above REVIEW_SCORE_THRESHOLD
 * (quality over volume, per the explicit request — a citable scientific
 * paper/book/checklist about the right region+taxon, not just whatever
 * volume a keyword search turned up); the rest are still on disk
 * (research-pipeline's raw/runs/<runId>-candidates.json) but never shown
 * here and never analyzed unless the user changes the underlying query.
 * Remove is reversible (excludeReviewCandidate), same optimistic-hide
 * pattern as DocumentsTable. Continue kicks off Stage B for whatever
 * survives.
 */
function ReviewGate({
  runId,
  candidates,
  counts,
  onRefetch,
}: {
  runId: string;
  candidates: ReviewCandidate[];
  counts: Record<string, number>;
  onRefetch: () => void;
}) {
  const [excludedSlugs, setExcludedSlugs] = useState<Set<string>>(new Set());
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranked = candidates
    .filter((c) => c.score >= REVIEW_SCORE_THRESHOLD && !c.excluded && !excludedSlugs.has(c.slug))
    .sort((a, b) => b.score - a.score);
  const belowThresholdCount = counts.papersBelowThreshold ?? candidates.filter((c) => c.score < REVIEW_SCORE_THRESHOLD).length;

  async function handleRemove(slug: string) {
    setPendingSlug(slug);
    setError(null);
    try {
      await excludeReviewCandidate(runId, slug, true);
      setExcludedSlugs((prev) => new Set(prev).add(slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove this paper.");
    } finally {
      setPendingSlug(null);
    }
  }

  async function handleContinue() {
    setIsContinuing(true);
    setError(null);
    try {
      await continueDeepSearch(runId);
      onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start analysis.");
      setIsContinuing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-on-surface-variant">
        {ranked.length} citable, on-topic source{ranked.length === 1 ? "" : "s"} found (score ≥ {REVIEW_SCORE_THRESHOLD}/100)
        {belowThresholdCount > 0 && <> — {belowThresholdCount} lower-relevance result{belowThresholdCount === 1 ? "" : "s"} filtered out automatically.</>}
        {" "}Remove anything that doesn't belong, then continue to full-text analysis.
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {ranked.length === 0 ? (
        <p className="text-xs text-on-surface-variant">
          Nothing cleared the relevance threshold — try a broader region/taxon, or add a paper manually.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
          {ranked.map((c) => (
            <ReviewCandidateRow key={c.slug} candidate={c} pending={pendingSlug === c.slug} onRemove={() => handleRemove(c.slug)} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          type="button"
          disabled={isContinuing || ranked.length === 0}
          onClick={handleContinue}
          className="mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
        >
          {isContinuing && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
          {isContinuing ? "Starting Analysis…" : `Continue with ${ranked.length}`}
        </button>
      </div>
    </div>
  );
}

const DOC_TYPE_SHORT_LABELS: Record<ReviewCandidate["documentType"], string> = {
  checklist: "Literature",
  scientific_paper: "Sci. Paper",
  other: "Other",
};

function ReviewCandidateRow({
  candidate,
  pending,
  onRemove,
}: {
  candidate: ReviewCandidate;
  pending: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border border-outline-variant rounded-sm px-3 py-2">
      <div className="flex flex-col items-center justify-center w-10 shrink-0">
        <span className="font-code-md text-[13px] font-bold text-on-surface">{candidate.score}</span>
        <span className="font-label-caps text-[8px] text-on-surface-variant/70">SCORE</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-on-surface truncate">
          {candidate.title}
          {candidate.year && <span className="text-on-surface-variant"> ({candidate.year})</span>}
        </p>
        <p className="text-[10px] text-on-surface-variant flex items-center gap-1.5">
          <span>{DOC_TYPE_SHORT_LABELS[candidate.documentType]}</span>
          {!candidate.citable && <span className="text-amber-600">⚠ not clearly citable</span>}
          {candidate.speciesRecordScore < 35 && <span className="text-amber-600">⚠ may not be species-record literature</span>}
          {candidate.accessibilityScore < 40 && <span className="text-amber-600">⚠ full text may be unobtainable</span>}
          {candidate.authors && <span className="truncate">{candidate.authors}</span>}
        </p>
      </div>
      {candidate.link && (
        <a
          href={candidate.link}
          target="_blank"
          rel="noreferrer"
          title={candidate.link}
          className="text-primary hover:text-brand inline-flex items-center shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">open_in_new</span>
        </a>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={onRemove}
        title="Remove this paper from the review pool"
        className="text-on-surface-variant hover:text-red-600 disabled:opacity-50 shrink-0"
      >
        <span className="material-symbols-outlined text-[16px]">delete</span>
      </button>
    </div>
  );
}

type ResultsTab = "documents" | "species";

function ResultsView({
  results,
  onDocumentExcluded,
  onAdd,
  added,
}: {
  results: DeepSearchResults | null;
  onDocumentExcluded: () => void;
  onAdd: (records: RawSpeciesRecord[]) => void;
  added: boolean;
}) {
  const [tab, setTab] = useState<ResultsTab>("documents");

  if (!results) return <p className="text-xs text-on-surface-variant">Run finished, but no results were found.</p>;

  return (
    <div className="flex flex-col gap-4">
      {!results.llmEnabled && (
        <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 rounded-sm">
          Species/coordinate extraction needs an LLM configured for this run — zero species doesn&apos;t mean none
          exist, just that none were analyzed yet.
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Documents Found" value={results.documentsFound} highlight />
        <StatCard label="Scientific Papers" value={results.scientificPapersFound} />
        <StatCard label="Total Candidate Species" value={results.species.length} />
      </div>

      <div className="flex items-center justify-between gap-3 border border-outline-variant bg-surface px-3 py-2 rounded-sm">
        <p className="text-xs text-on-surface-variant">
          {added
            ? "Added to the candidate species pool — see the Literature source in Step 2/3."
            : "Add these species to the candidate species pool (Step 2/3), under the Literature source."}
        </p>
        <button
          type="button"
          disabled={results.species.length === 0 || added}
          onClick={() => onAdd(toLiteratureRecords(results))}
          className="mono-text text-[10px] font-bold uppercase px-4 py-2 rounded-sm bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 shrink-0"
        >
          {added ? "Added" : "Add"}
        </button>
      </div>

      {(results.possiblyOffRegionCount > 0 || results.possiblyWrongTaxonCount > 0) && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
          {results.possiblyOffRegionCount > 0 && (
            <>
              <span className="font-bold">{results.possiblyOffRegionCount}</span> about the broader area only
            </>
          )}
          {results.possiblyOffRegionCount > 0 && results.possiblyWrongTaxonCount > 0 && ", "}
          {results.possiblyWrongTaxonCount > 0 && (
            <>
              <span className="font-bold">{results.possiblyWrongTaxonCount}</span> likely off-topic (keyword match
              only)
            </>
          )}{" "}
          — marked <span className="font-bold">⚠</span> below, sorted last.
        </p>
      )}

      <div>
        <div className="flex items-center gap-1 border-b border-outline-variant mb-2">
          <TabButton label={`Documents (${results.documents.length})`} active={tab === "documents"} onClick={() => setTab("documents")} />
          <TabButton label={`Species (${results.species.length})`} active={tab === "species"} onClick={() => setTab("species")} />
        </div>
        {tab === "documents" ? (
          <DocumentsTable documents={results.documents} onDocumentExcluded={onDocumentExcluded} />
        ) : (
          <SpeciesTable species={results.species} />
        )}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mono-text text-[10px] font-bold uppercase px-3 py-1.5 border-b-2 ${
        active ? "border-brand text-brand" : "border-transparent text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Documents are sourced fresh from the run's status poll every time, so a
 * remove can't just splice local state and forget it — the next poll would
 * bring the row right back. Tracks which slugs are mid-request/just-excluded
 * locally (hides them immediately, optimistic) and relies on
 * onDocumentExcluded (a refetch) to bring back the now-server-truthful list,
 * same pattern as ContributeDialog's addedOverlay/removedSlugs.
 */
type RecordsFilter = "all" | "with_records" | "without_records";

const RECORDS_FILTER_LABELS: Record<RecordsFilter, string> = {
  all: "All",
  with_records: "With Records",
  without_records: "Without Records",
};

function DocumentsTable({ documents, onDocumentExcluded }: { documents: DeepSearchDocument[]; onDocumentExcluded: () => void }) {
  const [excludedSlugs, setExcludedSlugs] = useState<Set<string>>(new Set());
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordsFilter, setRecordsFilter] = useState<RecordsFilter>("all");

  const visibleDocuments = documents
    .filter((doc) => !excludedSlugs.has(doc.slug))
    .filter((doc) => {
      if (recordsFilter === "with_records") return doc.speciesCount > 0;
      if (recordsFilter === "without_records") return doc.speciesCount === 0;
      return true;
    });

  async function handleExclude(slug: string) {
    setPendingSlug(slug);
    setError(null);
    try {
      await setDocumentExcluded(slug, true);
      setExcludedSlugs((prev) => new Set(prev).add(slug));
      onDocumentExcluded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove document.");
    } finally {
      setPendingSlug(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="flex items-center gap-1 mb-2">
        {(Object.keys(RECORDS_FILTER_LABELS) as RecordsFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setRecordsFilter(filter)}
            className={`mono-text text-[10px] font-bold uppercase px-2.5 py-1 rounded-sm border ${
              recordsFilter === filter
                ? "border-brand text-brand bg-brand/5"
                : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            {RECORDS_FILTER_LABELS[filter]}
          </button>
        ))}
      </div>
      {visibleDocuments.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No documents found.</p>
      ) : (
      <table className="w-full text-xs table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="w-14" />
          <col className="w-24" />
          <col className="w-16" />
          <col className="w-16" />
          <col className="w-10" />
          <col className="w-10" />
        </colgroup>
        <thead>
          <tr className="text-left text-on-surface-variant border-b border-outline-variant">
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Title</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Year</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Type</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Relevance</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Species</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Link</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]" />
          </tr>
        </thead>
        <tbody>
          {visibleDocuments.map((doc) => {
            const possiblyOffRegion = (doc.regionRelevance ?? 100) < 40;
            const possiblyWrongTaxon = (doc.taxonRelevance ?? 100) < 40;
            const warning = possiblyOffRegion && possiblyWrongTaxon
              ? "Wrong region and wrong taxon — likely a keyword-only match"
              : possiblyOffRegion
                ? "Only mentions the broader area, not the specific place requested"
                : possiblyWrongTaxon
                  ? "Doesn't appear to be about the requested taxon — likely a keyword-only match"
                  : undefined;
            return (
              <tr key={doc.slug} className="border-b border-outline-variant/30">
                <td className="py-1.5 pr-2 text-on-surface break-words">
                  {doc.flagged && (
                    <span title={doc.flagReason ?? "Flagged by the final review pass"} className="mr-1">
                      🚩
                    </span>
                  )}
                  {warning && (
                    <span title={warning} className="text-amber-600 mr-1">
                      ⚠
                    </span>
                  )}
                  {doc.title}
                  {doc.authors && <span className="text-on-surface-variant"> — {doc.authors}</span>}
                </td>
                <td className="py-1.5 pr-2 text-on-surface-variant whitespace-nowrap">{doc.year ?? "—"}</td>
                <td className="py-1.5 pr-2 text-on-surface-variant">
                  {DOCUMENT_TYPE_LABELS[doc.documentType]}
                  {doc.documentType === "other" && doc.greySignalCredible && (
                    <span className="text-green-700"> (credible)</span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-on-surface-variant whitespace-nowrap">{doc.relevance ?? "—"}</td>
                <td className="py-1.5 pr-2 text-on-surface-variant whitespace-nowrap">{doc.speciesCount}</td>
                <td className="py-1.5 pr-2">
                  {doc.link ? (
                    <a
                      href={doc.link}
                      target="_blank"
                      rel="noreferrer"
                      title={doc.link}
                      className="text-primary hover:text-brand inline-flex items-center"
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    </a>
                  ) : (
                    <span className="text-on-surface-variant/40">—</span>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <button
                    type="button"
                    disabled={pendingSlug === doc.slug}
                    onClick={() => handleExclude(doc.slug)}
                    title="Remove this document from the listing"
                    className="text-on-surface-variant hover:text-red-600 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
    </div>
  );
}

/** Occurrence-coordinates cell shared by the species tables — shows a count with a hover tooltip listing the actual lat/lng pairs, or "—" when none were extracted. Never invents a location: this only ever reflects what coordinateExtraction.ts found in the source text. */
function CoordinatesCell({ coordinates }: { coordinates: Array<{ lat: number; lng: number }> }) {
  if (coordinates.length === 0) return <span className="text-on-surface-variant/40">—</span>;
  const tooltip = coordinates.map((c) => `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`).join("\n");
  return (
    <span title={tooltip} className="text-on-surface-variant">
      {coordinates.length} location{coordinates.length === 1 ? "" : "s"}
    </span>
  );
}

/** Which paper(s) a species actually came from — title (+ link when there's exactly one) and a red flag when any contributing paper was itself flagged/off-region, so a contamination case (e.g. a wrong-district paper that cleared the relevance threshold) is visible right in the species row instead of requiring a manual cross-check against the Documents tab. */
function SpeciesDocumentsCell({
  documents,
}: {
  documents: Array<{ title: string; year?: number; link?: string; documentFlagged?: boolean }>;
}) {
  if (documents.length === 0) return <span className="text-on-surface-variant/40">—</span>;
  const anyFlagged = documents.some((d) => d.documentFlagged);
  const tooltip = documents
    .map((d) => `${d.documentFlagged ? "⚠ " : ""}${d.title}${d.year ? ` (${d.year})` : ""}`)
    .join("\n");
  const textClass = anyFlagged ? "text-red-600 font-bold" : "text-on-surface-variant";
  if (documents.length === 1 && documents[0].link) {
    return (
      <a href={documents[0].link} target="_blank" rel="noreferrer" title={tooltip} className={`underline ${textClass}`}>
        {anyFlagged && "⚠ "}1
      </a>
    );
  }
  return (
    <span title={tooltip} className={textClass}>
      {anyFlagged && "⚠ "}
      {documents.length}
    </span>
  );
}

function SpeciesTable({ species }: { species: DeepSearchSpecies[] }) {
  if (species.length === 0) {
    return (
      <p className="text-xs text-on-surface-variant">
        No species extracted yet — this needs an LLM configured for the run (see notice above) and full text
        resolved for at least some documents.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-on-surface-variant border-b border-outline-variant">
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Scientific Name</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Common Name</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]" title="Hover to see which paper(s) this species came from">Sources</th>
            <th className="py-1.5 pr-2 font-bold uppercase text-[9px]">Occurrences</th>
          </tr>
        </thead>
        <tbody>
          {species.map((sp) => (
            <tr key={sp.scientificName} className="border-b border-outline-variant/30">
              <td className="py-1.5 pr-2 text-on-surface italic">
                {sp.scientificName}
                {sp.backboneValidated && (
                  <span title="Confirmed against the GBIF backbone taxonomy" className="text-green-600 not-italic ml-1">
                    ✓
                  </span>
                )}
                {sp.flagged && (
                  <span title={sp.flagReason ?? "Flagged by the final review pass"} className="not-italic ml-1">
                    🚩
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2 text-on-surface-variant">{sp.commonName ?? "—"}</td>
              <td className="py-1.5 pr-2">
                <SpeciesDocumentsCell documents={sp.documents} />
              </td>
              <td className="py-1.5 pr-2">
                <CoordinatesCell coordinates={sp.coordinates} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, highlight, title }: { label: string; value: number; highlight?: boolean; title?: string }) {
  return (
    <div
      title={title}
      className={`border border-outline-variant px-3 py-2 flex flex-col gap-0.5 ${
        highlight ? "bg-primary-container/20" : "bg-surface"
      }`}
    >
      <span className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant/70">{label}</span>
      <span className="font-code-md text-[14px] font-bold text-on-surface">{value}</span>
    </div>
  );
}
