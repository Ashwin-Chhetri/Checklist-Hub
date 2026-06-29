import type { Watcher, WatcherRun, WatcherRunDetail } from "@/types/watching.types";

export interface WatcherConfigResponse {
  watcher: Watcher | null;
  subscribers: string[];
}

export async function getWatcher(checklistId: string): Promise<WatcherConfigResponse> {
  const response = await fetch(`/api/checklists/${checklistId}/watcher`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Failed to load watcher.");
  return body as WatcherConfigResponse;
}

export async function saveWatcher(
  checklistId: string,
  input: { frequency: "weekly" | "monthly"; subscriber_user_ids: string[] },
): Promise<WatcherConfigResponse> {
  const response = await fetch(`/api/checklists/${checklistId}/watcher`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Failed to save watcher.");
  return body as WatcherConfigResponse;
}

export async function deactivateWatcher(checklistId: string): Promise<void> {
  const response = await fetch(`/api/checklists/${checklistId}/watcher`, { method: "DELETE" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Failed to deactivate watcher.");
}

export async function listWatcherRuns(checklistId: string, limit = 20): Promise<WatcherRun[]> {
  const response = await fetch(`/api/checklists/${checklistId}/watcher/runs?limit=${limit}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Failed to load watcher runs.");
  return body.runs as WatcherRun[];
}

export async function getWatcherRunDetail(checklistId: string, runId: string): Promise<WatcherRunDetail> {
  const response = await fetch(`/api/checklists/${checklistId}/watcher/runs/${runId}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Failed to load watcher run.");
  return body as WatcherRunDetail;
}

export async function runWatcherNow(checklistId: string): Promise<{ runId: string }> {
  const response = await fetch(`/api/checklists/${checklistId}/watcher/run-now`, { method: "POST" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Failed to run the watcher.");
  return body as { runId: string };
}

export async function applyWatcherRun(
  checklistId: string,
  runId: string,
  acceptedCandidateIds: string[],
): Promise<void> {
  const response = await fetch(`/api/checklists/${checklistId}/watcher/runs/${runId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accepted_candidate_ids: acceptedCandidateIds }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Failed to apply watcher run.");
}
