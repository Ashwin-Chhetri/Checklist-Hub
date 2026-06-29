"use client";

import { useMemo, useState } from "react";
import type { Collaborator } from "@/types/collaboration.types";
import type { WatchFrequency, Watcher, WatcherRun } from "@/types/watching.types";
import {
  useApplyWatcherRun,
  useRunWatcherNow,
  useSaveWatcher,
  useWatcherRunDetail,
} from "@/modules/watching/hooks/useWatcher";
import { EVIDENCE_SOURCE_LABELS } from "@/modules/editor/utils/badges";

function addInterval(date: Date, frequency: WatchFrequency): Date {
  const next = new Date(date);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface WatcherSetupDialogProps {
  checklistId: string;
  checklistCreatedAt: string;
  watcher: Watcher | null;
  subscriberIds: string[];
  collaborators: Collaborator[];
  currentUserId?: string;
  currentUserName?: string | null;
  watcherRuns?: WatcherRun[];
  onSelectRun?: (runId: string) => void;
  onClose: () => void;
}

export default function WatcherSetupDialog({
  checklistId,
  checklistCreatedAt,
  watcher,
  subscriberIds,
  collaborators,
  currentUserId,
  currentUserName,
  watcherRuns = [],
  onSelectRun,
  onClose,
}: WatcherSetupDialogProps) {
  const [frequency, setFrequency] = useState<WatchFrequency>(watcher?.frequency ?? "weekly");
  // Members eligible to be alerted: every collaborator plus the current user
  // (who may be the owner and so absent from the collaborators list).
  const members = useMemo(() => {
    const list = collaborators.map((c) => ({
      id: c.user_id,
      name: c.profile?.full_name ?? c.profile?.email ?? c.user_id,
    }));
    if (currentUserId && !list.some((m) => m.id === currentUserId)) {
      list.unshift({ id: currentUserId, name: currentUserName ?? "You" });
    }
    return list;
  }, [collaborators, currentUserId, currentUserName]);
  // The current user is alerted by default so they don't have to remember to add themselves.
  const [selectedSubscribers, setSelectedSubscribers] = useState<Set<string>>(
    () => new Set(currentUserId ? [...subscriberIds, currentUserId] : subscriberIds),
  );
  const saveWatcher = useSaveWatcher(checklistId);
  const runNow = useRunWatcherNow(checklistId);

  const watchingSince = watcher?.started_at ?? checklistCreatedAt;
  const nextRunDate = useMemo(
    () => formatDate(addInterval(new Date(watcher?.last_run_at ?? watchingSince), frequency)),
    [watchingSince, watcher?.last_run_at, frequency],
  );

  function handleUpdateObservations() {
    runNow.mutate(undefined, {
      onSuccess: ({ runId }) => onSelectRun?.(runId),
    });
  }

  function addSubscriber(userId: string) {
    if (!userId) return;
    setSelectedSubscribers((prev) => new Set(prev).add(userId));
  }

  function removeSubscriber(userId: string) {
    setSelectedSubscribers((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }

  function handleSave() {
    saveWatcher.mutate(
      { frequency, subscriber_user_ids: [...selectedSubscribers] },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-[32rem] max-w-[90vw] p-5 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Watcher</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed mb-4">
          Turning on the watcher puts this checklist in a watching state: on a weekly or monthly schedule, new
          occurrences are fetched from GBIF and iNaturalist (and eBird, when this checklist is scoped to Aves).
          If a genuinely new candidate species or new observations on an existing species are found, the
          collaborators you choose below are alerted by email and an in-app notification.
        </p>

        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Frequency</h4>
        <div className="flex items-center gap-4 mb-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="radio"
              name="watcher-frequency"
              checked={frequency === "weekly"}
              onChange={() => setFrequency("weekly")}
            />
            Weekly
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="radio"
              name="watcher-frequency"
              checked={frequency === "monthly"}
              onChange={() => setFrequency("monthly")}
            />
            Monthly
          </label>
        </div>
        <p className="text-[11px] text-slate-500 mb-1">
          Watching since <strong>{formatDate(new Date(watchingSince))}</strong>
        </p>
        <p className="text-[11px] text-slate-500 mb-4">
          Next run on <strong>{nextRunDate}</strong>
        </p>

        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
          Alert these collaborators
        </h4>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {[...selectedSubscribers].length === 0 && (
            <p className="text-xs text-slate-400">No one selected — add someone below.</p>
          )}
          {[...selectedSubscribers].map((id) => {
            const member = members.find((m) => m.id === id);
            return (
              <span
                key={id}
                className="flex items-center gap-1 pl-2 pr-1 py-1 border border-surface-dim rounded-sm bg-surface-container-low text-xs text-slate-700"
              >
                {member?.name ?? id}
                <button
                  type="button"
                  onClick={() => removeSubscriber(id)}
                  aria-label={`Remove ${member?.name ?? id}`}
                  className="leading-none text-slate-400 hover:text-brand px-0.5"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <select
          value=""
          onChange={(e) => addSubscriber(e.target.value)}
          disabled={members.every((m) => selectedSubscribers.has(m.id))}
          className="w-full mb-5 px-2 py-1.5 border border-surface-dim rounded-sm text-xs text-slate-700 bg-white disabled:opacity-50"
        >
          <option value="" disabled>
            {members.length === 0 ? "No collaborators yet" : "Add someone to alert…"}
          </option>
          {members
            .filter((m) => !selectedSubscribers.has(m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>

        {watcher && watcherRuns.length > 0 && (
          <>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Runs</h4>
            <div className="space-y-1.5 mb-5">
              {watcherRuns.slice(0, 5).map((run) => (
                <button
                  key={run.id}
                  onClick={() => onSelectRun?.(run.id)}
                  className="w-full flex items-center gap-2 p-1.5 bg-slate-100 hover:bg-slate-200 rounded-sm text-xs text-slate-700 transition-colors text-left"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      run.status === "completed"
                        ? "bg-green-500"
                        : run.status === "failed"
                          ? "bg-red-500"
                          : "bg-amber-500"
                    }`}
                  />
                  <span className="text-[11px]">
                    {new Date(run.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    {" · "}
                    {run.new_species_count} new · {run.updated_species_count} updated
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {watcher && (
          <>
            <button
              onClick={handleUpdateObservations}
              disabled={runNow.isPending}
              className="w-full bg-white text-on-surface mono-text text-[10px] font-bold uppercase px-3 py-2 rounded-sm border border-outline mb-1 hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {runNow.isPending && (
                <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              )}
              {runNow.isPending ? "Running…" : "Update Observations"}
            </button>
            {runNow.isError && (
              <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-sm px-2 py-1.5 mb-2">
                Couldn&apos;t run the watcher: {(runNow.error as Error).message}
              </p>
            )}
          </>
        )}

        {saveWatcher.isError && (
          <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-sm px-2 py-1.5 mb-2">
            Couldn&apos;t save: {(saveWatcher.error as Error).message}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saveWatcher.isPending}
          className="w-full bg-brand text-white mono-text text-[10px] font-bold uppercase px-3 py-2 rounded-sm shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saveWatcher.isPending && (
            <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
          )}
          {saveWatcher.isPending ? "Saving…" : watcher ? "Save Watcher Settings" : "Start Watching"}
        </button>
      </div>
    </div>
  );
}

function formatCounts(counts: Partial<Record<string, number>>): string {
  const entries = Object.entries(counts).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return "—";
  return entries.map(([source, count]) => `${EVIDENCE_SOURCE_LABELS[source] ?? source}: ${count}`).join(" · ");
}

interface WatcherResultsDialogProps {
  checklistId: string;
  runId: string;
  onClose: () => void;
}

export function WatcherResultsDialog({ checklistId, runId, onClose }: WatcherResultsDialogProps) {
  const { data, isLoading } = useWatcherRunDetail(checklistId, runId);
  const applyRun = useApplyWatcherRun(checklistId, runId);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"occurrences" | "candidates">("occurrences");
  // True once this run has nothing left to review — every candidate has
  // already been resolved (added/dismissed) and every observation update
  // applied, which is exactly the state handleApply leaves a run in.
  const alreadyApplied =
    !!data &&
    data.candidates.every((c) => c.status !== "pending") &&
    data.observationUpdates.every((u) => u.applied);

  function toggleAccepted(id: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApply() {
    applyRun.mutate([...accepted], { onSuccess: onClose });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-[40rem] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Watcher Run</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {isLoading && <p className="px-5 pb-5 text-xs text-slate-400">Loading…</p>}

        {data && (
          <>
            <div className="flex items-center gap-1 mb-4 mx-5 bg-surface-container-low p-1 rounded-sm border border-outline-variant w-fit shrink-0">
              <button
                onClick={() => setActiveTab("occurrences")}
                className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  activeTab === "occurrences"
                    ? "bg-white text-brand shadow-sm"
                    : "text-slate-500 hover:text-brand"
                }`}
              >
                New Occurrences ({data.observationUpdates.length})
              </button>
              <button
                onClick={() => setActiveTab("candidates")}
                className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  activeTab === "candidates"
                    ? "bg-white text-brand shadow-sm"
                    : "text-slate-500 hover:text-brand"
                }`}
              >
                New Candidate Species ({data.candidates.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 min-h-0">
              {activeTab === "occurrences" ? (
                <div className="mb-5 border border-surface-dim rounded-sm overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-container-low text-[9px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="text-left px-2.5 py-1.5">Species</th>
                        <th className="text-left px-2.5 py-1.5">Previous</th>
                        <th className="text-left px-2.5 py-1.5">New</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-dim">
                      {data.observationUpdates.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-2.5 py-3 text-center text-slate-400">
                            No new observations on existing species in this run.
                          </td>
                        </tr>
                      )}
                      {data.observationUpdates.map((u) => (
                        <tr key={u.id} className="bg-white">
                          <td className="px-2.5 py-1.5 italic text-slate-700">
                            {u.species?.scientific_name ?? u.species_id}
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-500">
                            {u.previous_total.toLocaleString()}
                            <span className="block text-[9px] text-slate-400">{formatCounts(u.previous_counts)}</span>
                          </td>
                          <td className="px-2.5 py-1.5 font-bold text-slate-700">
                            {u.new_total.toLocaleString()}
                            <span className="block text-[9px] font-normal text-slate-400">
                              {formatCounts(u.new_counts)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mb-5 border border-surface-dim rounded-sm overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-container-low text-[9px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="w-8 px-2.5 py-1.5" />
                        <th className="text-left px-2.5 py-1.5">Species</th>
                        <th className="text-left px-2.5 py-1.5">Occurrences</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-dim">
                      {data.candidates.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-2.5 py-3 text-center text-slate-400">
                            No new candidate species in this run.
                          </td>
                        </tr>
                      )}
                      {data.candidates.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => toggleAccepted(c.id)}
                          className="bg-white cursor-pointer hover:bg-surface-container-low/50"
                        >
                          <td className="px-2.5 py-1.5">
                            <input
                              type="checkbox"
                              checked={accepted.has(c.id)}
                              onChange={() => toggleAccepted(c.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-700">
                            <span className="italic">{c.scientific_name}</span>
                            {c.common_name && <span className="text-slate-400"> ({c.common_name})</span>}
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-500">{formatCounts(c.occurrence_counts)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-5 pb-5 pt-3 border-t border-surface-dim shrink-0">
              <button
                onClick={handleApply}
                disabled={applyRun.isPending || alreadyApplied}
                className="w-full bg-brand text-white mono-text text-[10px] font-bold uppercase px-3 py-2 rounded-sm shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
              >
                {alreadyApplied ? "Already Updated" : "Updated"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
