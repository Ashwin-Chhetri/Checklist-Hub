import { useMutation, useQuery } from "@tanstack/react-query";
import { startDeepSearch, getDeepSearchStatus } from "../services/deepSearchService";

const TERMINAL_PHASES = new Set(["done", "error"]);

/**
 * Drives one deep-search run: starts it (POST), then polls status (GET)
 * every 3s until it reaches a terminal phase — same "kick off, then poll"
 * shape as the evidence-discovery system's per-provider progress (see
 * useSpeciesInventory.ts), just against a single longer-running run instead
 * of several parallel ones.
 *
 * `runId`/`setRunId` are owned by the caller (page.tsx, persisted to the
 * wizard draft) rather than this hook's own local state — a run is a
 * detached server-side process that keeps going regardless of whether the
 * dialog is open, so closing the dialog (even accidentally) or navigating
 * wizard steps must not lose track of which run is in flight. Re-mounting
 * with the same `runId` just resumes polling the existing run instead of
 * starting a new one.
 */
export function useDeepSearch(runId: string | null, setRunId: (runId: string | null) => void) {
  const start = useMutation({
    mutationFn: ({ region, taxonGroup, resultsPerQuery }: { region: string; taxonGroup: string; resultsPerQuery?: number }) =>
      startDeepSearch(region, taxonGroup, resultsPerQuery),
    onSuccess: (data) => setRunId(data.runId),
  });

  const status = useQuery({
    queryKey: ["deep-search-status", runId],
    queryFn: () => getDeepSearchStatus(runId as string),
    enabled: runId !== null,
    refetchInterval: (query) => (query.state.data && TERMINAL_PHASES.has(query.state.data.status.phase) ? false : 3000),
    // Long-running pipeline runs (minutes) shouldn't have their cached
    // status evicted just because the dialog was closed for a while —
    // reopening (or revisiting Step 2) should show the last-known state
    // immediately rather than a blank loading screen while it re-fetches.
    gcTime: 30 * 60 * 1000,
  });

  return {
    start: (region: string, taxonGroup: string, resultsPerQuery?: number) => start.mutate({ region, taxonGroup, resultsPerQuery }),
    isStarting: start.isPending,
    startError: start.error as Error | null,
    runId,
    status: status.data?.status ?? null,
    results: status.data?.results ?? null,
    reviewCandidates: status.data?.reviewCandidates ?? null,
    isPolling: status.isFetching,
    pollError: status.error as Error | null,
    reset: () => setRunId(null),
    refetch: status.refetch,
  };
}
