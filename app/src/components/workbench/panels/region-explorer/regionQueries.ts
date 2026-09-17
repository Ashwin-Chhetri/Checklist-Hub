"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { BoundaryGeometry, RegionBoundaryRequest } from "@/modules/checklist/services/regionApi";
import { fetchProtectedAreas, fetchWaterBodies, type Bbox } from "./overpassApi";
import { computeRegionStats, type RegionStats } from "./regionStats";

/**
 * One shared key scheme for every region-explorer query (boundary, protected
 * areas, water bodies, region stats) — mirrors useRegionBoundary's own key
 * shape so all of a region's data lives under the same identity and the
 * QueryProvider's persistence filter (queryKey[0] === "region") catches all
 * of it in one place.
 */
export function regionQueryKey(kind: string, request: RegionBoundaryRequest | null | undefined) {
  return ["region", kind, request?.gadmId ?? null, request?.osmType ?? null, request?.osmId ?? null, request?.boundingBox ?? null] as const;
}

// A fixed region's overlays/stats never change — no reason to ever refetch
// or garbage-collect them while the tab stays open, and the sessionStorage
// persister (see QueryProvider) carries them across a page refresh too.
const REGION_DATA_CACHE_OPTIONS = {
  staleTime: Infinity,
  gcTime: 24 * 60 * 60 * 1000,
} as const;

export function useProtectedAreas(bbox: Bbox | null, request: RegionBoundaryRequest | null | undefined) {
  return useQuery({
    queryKey: regionQueryKey("protected-areas", request),
    queryFn: () => fetchProtectedAreas(bbox!),
    enabled: !!bbox,
    ...REGION_DATA_CACHE_OPTIONS,
  });
}

export function useWaterBodies(bbox: Bbox | null, request: RegionBoundaryRequest | null | undefined) {
  return useQuery({
    queryKey: regionQueryKey("water-bodies", request),
    queryFn: () => fetchWaterBodies(bbox!),
    enabled: !!bbox,
    ...REGION_DATA_CACHE_OPTIONS,
  });
}

export function useRegionStats(boundary: BoundaryGeometry | null, bbox: Bbox | null, request: RegionBoundaryRequest | null | undefined) {
  return useQuery({
    queryKey: regionQueryKey("stats", request),
    queryFn: () => computeRegionStats(boundary!, bbox!),
    enabled: !!boundary && !!bbox,
    ...REGION_DATA_CACHE_OPTIONS,
  });
}

/**
 * Kicks off all of a region's overlay/stat fetches as soon as the boundary is
 * known, regardless of which dialog tab is currently visible — called once
 * from MapListDialog on mount so the Map tab's data (and the Stats tab's) is
 * already in flight/cached by the time the user switches to it, and a later
 * reopen of the same region is instant.
 */
export function prefetchRegionData(
  queryClient: QueryClient,
  boundary: BoundaryGeometry | null,
  bbox: Bbox | null,
  request: RegionBoundaryRequest | null | undefined,
) {
  if (!bbox) return;
  queryClient.prefetchQuery({ queryKey: regionQueryKey("protected-areas", request), queryFn: () => fetchProtectedAreas(bbox), ...REGION_DATA_CACHE_OPTIONS });
  queryClient.prefetchQuery({ queryKey: regionQueryKey("water-bodies", request), queryFn: () => fetchWaterBodies(bbox), ...REGION_DATA_CACHE_OPTIONS });
  if (boundary) {
    queryClient.prefetchQuery({ queryKey: regionQueryKey("stats", request), queryFn: () => computeRegionStats(boundary, bbox), ...REGION_DATA_CACHE_OPTIONS });
  }
}

export type { RegionStats };
