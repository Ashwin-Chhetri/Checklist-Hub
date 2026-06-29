import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyWatcherRun,
  deactivateWatcher,
  getWatcher,
  getWatcherRunDetail,
  listWatcherRuns,
  runWatcherNow,
  saveWatcher,
} from "../services/watchingService";

export function useWatcher(checklistId: string) {
  return useQuery({
    queryKey: ["checklists", checklistId, "watcher"],
    queryFn: () => getWatcher(checklistId),
    enabled: !!checklistId,
  });
}

export function useSaveWatcher(checklistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { frequency: "weekly" | "monthly"; subscriber_user_ids: string[] }) =>
      saveWatcher(checklistId, input),
    // Write the response straight into the cache rather than just invalidating —
    // the PUT response has the exact same shape useWatcher caches, so this
    // updates the sidebar's Weekly/Monthly tag the instant the mutation
    // resolves instead of waiting on a separate refetch round trip.
    onSuccess: (data) => {
      queryClient.setQueryData(["checklists", checklistId, "watcher"], data);
    },
  });
}

export function useDeactivateWatcher(checklistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deactivateWatcher(checklistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "watcher"] });
    },
  });
}

export function useWatcherRuns(checklistId: string) {
  return useQuery({
    queryKey: ["checklists", checklistId, "watcher", "runs"],
    queryFn: () => listWatcherRuns(checklistId),
    enabled: !!checklistId,
    refetchInterval: 60_000,
  });
}

export function useWatcherRunDetail(checklistId: string, runId: string | null) {
  return useQuery({
    queryKey: ["checklists", checklistId, "watcher", "runs", runId],
    queryFn: () => getWatcherRunDetail(checklistId, runId as string),
    enabled: !!checklistId && !!runId,
  });
}

export function useRunWatcherNow(checklistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runWatcherNow(checklistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "watcher"] });
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "watcher", "runs"] });
    },
  });
}

export function useApplyWatcherRun(checklistId: string, runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (acceptedCandidateIds: string[]) => applyWatcherRun(checklistId, runId, acceptedCandidateIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "watcher", "runs"] });
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "watcher", "runs", runId] });
      queryClient.invalidateQueries({ queryKey: ["species", "list", checklistId] });
    },
  });
}
