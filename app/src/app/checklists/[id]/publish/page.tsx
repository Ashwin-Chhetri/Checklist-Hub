"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useChecklist } from "@/modules/checklist/hooks/useChecklist";
import { usePublicationReadiness } from "@/modules/publication/hooks/usePublicationReadiness";
import { useAcceptedSpecies } from "@/modules/publication/hooks/useAcceptedSpecies";
import { useChecklistMetadata } from "@/modules/publication/hooks/useChecklistMetadata";
import { useMergeDuplicates } from "@/modules/publication/hooks/useMergeDuplicates";
import { usePublicationDraft, useSavePublicationDraftStage } from "@/modules/publication/hooks/usePublicationDraft";
import { PublishMetadataPage } from "@/modules/publication/components/PublishMetadataPage";
import { PublishPackagePage } from "@/modules/publication/components/PublishPackagePage";
import { PublishIptPage } from "@/modules/publication/components/PublishIptPage";
import AppHeader from "@/components/shared/AppHeader";

type Stage = "validate" | "metadata" | "review" | "ipt" | "done";

function isStage(value: string | null): value is Stage {
  return value === "metadata" || value === "review" || value === "ipt";
}

export default function PublishChecklistPage() {
  const params = useParams<{ id: string }>();
  const checklistId = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams.get("step");
  const initialIptStep = searchParams.get("iptStep") === "register" ? "register" : undefined;

  const { data: checklist } = useChecklist(checklistId);
  const { data: readiness, isLoading: isReadinessLoading } = usePublicationReadiness(checklistId);
  const { data: acceptedSpecies } = useAcceptedSpecies(checklistId);
  const { data: metadataResponse } = useChecklistMetadata(checklistId);
  const { data: draft } = usePublicationDraft(checklistId);
  const saveDraftStage = useSavePublicationDraftStage(checklistId);
  const mergeDuplicates = useMergeDuplicates(checklistId);

  const [stage, setStage] = useState<Stage>(() => (isStage(stepParam) ? stepParam : "validate"));

  // Resume where the user left off, once: if a draft already exists when
  // this page first loads, jump straight to its stage instead of always
  // starting at validation — unless the organizer linked here with an
  // explicit `?step=` (e.g. opening the metadata or package nested row
  // directly), which always wins. The draft's stage is only honored once
  // live readiness has loaded and confirms the checklist is actually ready
  // — otherwise a draft left over from before a metadata/package deletion
  // would skip validation despite the checklist no longer being ready.
  // Adjusted during render (React's recommended pattern for one-time
  // derived state from an async value) rather than in an effect.
  const [resumed, setResumed] = useState(isStage(stepParam));
  if (!resumed && draft && !isReadinessLoading) {
    setResumed(true);
    if (readiness?.is_ready) {
      setStage(draft.stage);
    }
  }

  function goToMetadata() {
    setStage("metadata");
    saveDraftStage.mutate({ stage: "metadata" });
  }

  if (stage === "metadata") {
    return (
      <PublishMetadataPage
        checklist={checklist}
        checklistId={checklistId}
        initialMetadata={metadataResponse ? metadataResponse.metadata : undefined}
        initialContributors={metadataResponse ? metadataResponse.contributors : undefined}
        acceptedSpecies={acceptedSpecies}
        onBack={() => setStage("validate")}
        onContinue={() => setStage("review")}
      />
    );
  }

  if (stage === "review") {
    return (
      <PublishPackagePage
        checklist={checklist}
        checklistId={checklistId}
        metadata={metadataResponse?.metadata ?? null}
        contributors={metadataResponse?.contributors ?? []}
        acceptedSpecies={acceptedSpecies ?? []}
        onBack={() => setStage("metadata")}
        onContinueToIpt={() => {
          setStage("ipt");
          saveDraftStage.mutate({ stage: "ipt" });
        }}
      />
    );
  }

  if (stage === "ipt") {
    return (
      <PublishIptPage
        checklist={checklist}
        checklistId={checklistId}
        metadata={metadataResponse?.metadata ?? null}
        contributors={metadataResponse?.contributors ?? []}
        draft={draft}
        initialStep={initialIptStep}
        onBack={() => setStage("review")}
        onPublished={() => setStage("done")}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface">
      <header className="h-14 border-b border-surface-dim bg-white flex items-center justify-between px-4 z-50">
        <div className="flex items-center gap-6">
          <AppHeader />
          <Link
            href={`/checklists/${checklistId}`}
            className="bg-brand text-white px-3 py-1.5 rounded-sm text-xs mono-text font-medium flex items-center gap-2 shadow-hard hover:translate-y-[-1px] transition-transform"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            {checklist?.title ?? "Loading..."}
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 bg-surface-container-low/30 overflow-y-auto">
        {stage === "validate" && (
          <div className="bg-white
                          border
                          border-surface-dim
                          shadow-hard
                          p-5
                          space-y-4
                          w-[480px]
                          min-w-[480px]
                          max-w-[480px]">
            <div className="text-center space-y-1">
              <h2 className="font-headline-md text-lg text-brand uppercase tracking-tight">
                {readiness?.is_ready ? "Ready for Publication" : "Not Ready Yet"}
              </h2>
              <p className="text-slate-500 text-xs">
                {checklist?.title ? `'${checklist.title}'` : "This checklist"}{" "}
                {readiness?.is_ready
                  ? "has passed all validation checks."
                  : "still has open items before it can be published."}
              </p>
            </div>

            {isReadinessLoading ? (
              <p className="text-center text-sm text-slate-400">Checking readiness...</p>
            ) : (
              <div className="space-y-1.5 border-y border-surface-dim py-3">
                <ReadinessRow
                  ok={
                    (readiness?.review_status_counts.not_reviewed ?? 0) === 0 &&
                    (readiness?.review_status_counts.under_review ?? 0) === 0 &&
                    (readiness?.total_species ?? 0) > 0
                  }
                  label="All species reviewed"
                  value={`${readiness?.review_status_counts.accepted ?? 0} / ${readiness?.total_species ?? 0}`}
                  checklistId={checklistId}
                />
                <ReadinessRow
                  ok={(readiness?.duplicate_groups.length ?? 0) === 0}
                  label="Duplicate taxa resolved"
                  value={
                    (readiness?.duplicate_groups.length ?? 0) === 0
                      ? "0 ISSUES"
                      : `${readiness?.duplicate_groups.length} ISSUES`
                  }
                  checklistId={checklistId}
                  issues={(readiness?.duplicate_groups ?? []).flatMap((group) =>
                    group.rows.map((r) => ({
                      speciesId: r.species_id,
                      label: r.scientific_name,
                      sublabel: `shares taxon ID ${group.gbif_taxon_key}`,
                    })),
                  )}
                  action={
                    (readiness?.duplicate_groups.length ?? 0) > 0
                      ? {
                          label: mergeDuplicates.isPending ? "Merging..." : "Auto-merge duplicates",
                          pending: mergeDuplicates.isPending,
                          onClick: () => mergeDuplicates.mutate(),
                        }
                      : undefined
                  }
                />
                <ReadinessRow
                  ok={(readiness?.unresolved_taxa.length ?? 0) === 0}
                  label="Unresolved taxa resolved"
                  value={
                    (readiness?.unresolved_taxa.length ?? 0) === 0
                      ? "0 ISSUES"
                      : `${readiness?.unresolved_taxa.length} ISSUES`
                  }
                  checklistId={checklistId}
                  issues={(readiness?.unresolved_taxa ?? []).map((r) => ({
                    speciesId: r.species_id,
                    label: r.scientific_name,
                  }))}
                />
                <ReadinessRow
                  ok={(readiness?.authority_conflicts.length ?? 0) === 0}
                  label="Taxonomic conflicts resolved"
                  value={
                    (readiness?.authority_conflicts.length ?? 0) === 0
                      ? "0 ISSUES"
                      : `${readiness?.authority_conflicts.length} ISSUES`
                  }
                  checklistId={checklistId}
                  issues={(readiness?.authority_conflicts ?? []).map((r) => ({
                    speciesId: r.species_id,
                    label: r.scientific_name,
                    sublabel: `${r.conflict_count} conflicting option${r.conflict_count === 1 ? "" : "s"}`,
                  }))}
                />
                <ReadinessRow
                  ok={
                    (readiness?.classification_issues.filter((i) => i.issue === "inconsistent_genus").length ?? 0) === 0
                  }
                  label="Classification consistency"
                  value={(() => {
                    const count =
                      readiness?.classification_issues.filter((i) => i.issue === "inconsistent_genus").length ?? 0;
                    return count === 0 ? "0 ISSUES" : `${count} ISSUES`;
                  })()}
                  checklistId={checklistId}
                  issues={(readiness?.classification_issues ?? [])
                    .filter((i) => i.issue === "inconsistent_genus")
                    .map((i) => ({ speciesId: i.species_id, label: i.scientific_name, sublabel: i.detail }))}
                />
                {mergeDuplicates.isError && (
                  <p className="text-[10px] text-error mono-text">{(mergeDuplicates.error as Error).message}</p>
                )}
                {(readiness?.classification_issues.filter((i) => i.issue === "missing_rank").length ?? 0) > 0 && (
                  <ReadinessRow
                    ok
                    label="Missing rank columns"
                    value={`${readiness?.classification_issues.filter((i) => i.issue === "missing_rank").length} (non-blocking)`}
                    checklistId={checklistId}
                    neutral
                    issues={(readiness?.classification_issues ?? [])
                      .filter((i) => i.issue === "missing_rank")
                      .map((i) => ({ speciesId: i.species_id, label: i.scientific_name, sublabel: i.detail }))}
                  />
                )}
                {(readiness?.synonym_pairs.length ?? 0) > 0 && (
                  <ReadinessRow
                    ok
                    label="Documented synonyms"
                    value={`${readiness?.synonym_pairs.length} (non-blocking)`}
                    checklistId={checklistId}
                    neutral
                    issues={(readiness?.synonym_pairs ?? []).map((r) => ({
                      speciesId: r.species_id,
                      label: r.imported_name,
                      sublabel: r.accepted_name ? `→ ${r.accepted_name}` : undefined,
                    }))}
                  />
                )}
              </div>
            )}

            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                disabled={!readiness?.is_ready}
                onClick={goToMetadata}
                className="w-full bg-brand text-white py-2.5 rounded-sm font-headline-md text-xs shadow-hard hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue to Checklist Metadata
              </button>
              <Link
                href={`/checklists/${checklistId}`}
                className="text-slate-400 mono-text text-[10px] uppercase font-bold hover:text-brand transition-colors"
              >
                Back to Species List
              </Link>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="w-full max-w-2xl bg-white border border-surface-dim shadow-hard p-8 space-y-6 text-center">
            <span className="material-symbols-outlined text-6xl text-emerald-600">check_circle</span>
            <h2 className="font-headline-md text-headline-lg text-brand uppercase tracking-tight">Published</h2>
            <p className="text-slate-500">
              {checklist?.title ?? "This checklist"} is now publicly available.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/checklists/${checklistId}`)}
              className="bg-brand text-white px-6 py-3 rounded-sm font-label-caps text-[12px] uppercase shadow-hard hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
            >
              Back to Checklist
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

interface ReadinessIssue {
  speciesId: string;
  label: string;
  sublabel?: string;
}

function ReadinessRow({
  ok,
  label,
  value,
  checklistId,
  issues = [],
  action,
  neutral = false,
}: {
  ok?: boolean;
  label: string;
  value: string;
  checklistId: string;
  issues?: ReadinessIssue[];
  action?: { label: string; onClick: () => void; pending?: boolean };
  neutral?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasIssues = issues.length > 0;
  const tone = neutral ? "slate" : ok ? "green" : "red";
  const toneClasses: Record<string, string> = {
    green: "bg-green-50 border-green-200",
    red: "bg-red-50 border-red-200",
    slate: "bg-slate-50 border-slate-200",
  };
  const textToneClasses: Record<string, string> = {
    green: "text-green-700",
    red: "text-red-700",
    slate: "text-slate-500",
  };

  return (
    <div className={`border rounded-sm ${toneClasses[tone]}`}>
      <button
        type="button"
        onClick={() => hasIssues && setExpanded((e) => !e)}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 ${hasIssues ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="flex items-center gap-2">
          {!neutral && (
            <span className={`material-symbols-outlined text-[16px] ${ok ? "text-green-600" : "text-red-600"}`}>
              {ok ? "check_circle" : "error"}
            </span>
          )}
          {neutral && <span className="material-symbols-outlined text-[14px] text-slate-400">info</span>}
          <span className="mono-text text-[11px] font-bold">{label}</span>
          {hasIssues && (
            <span className="material-symbols-outlined text-[14px] text-slate-400">
              {expanded ? "expand_less" : "expand_more"}
            </span>
          )}
        </div>
        <span className={`mono-text text-[11px] ${textToneClasses[tone]}`}>{value}</span>
      </button>

      {expanded && hasIssues && (
        <div className="px-2.5 pb-2 space-y-1">
          {action && (
            <button
              type="button"
              disabled={action.pending}
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
              }}
              className="mb-1 w-full text-[10px] font-bold uppercase mono-text bg-brand text-white rounded-sm py-1 hover:opacity-90 disabled:opacity-50"
            >
              {action.label}
            </button>
          )}
          <ul className="space-y-0.5 max-h-40 overflow-y-auto">
            {issues.map((issue, idx) => (
              <li key={`${issue.speciesId}-${idx}`}>
                <Link
                  href={`/checklists/${checklistId}?species=${issue.speciesId}`}
                  target="_blank"
                  className="flex items-center justify-between px-2 py-1 bg-white border border-surface-dim rounded-sm hover:border-brand transition-colors"
                >
                  <span className="mono-text text-[10px] italic text-on-surface">{issue.label}</span>
                  {issue.sublabel && (
                    <span className="mono-text text-[9px] text-slate-400">{issue.sublabel}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
