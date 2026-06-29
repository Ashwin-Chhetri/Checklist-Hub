"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRegionBoundary, type RegionBoundaryRequest } from "@/modules/checklist/services/regionApi";

/** A region's boundary never changes — cache effectively for the session. */
export function useRegionBoundary(request: RegionBoundaryRequest | null | undefined) {
  const gadmId = request?.gadmId ?? null;
  const osmType = request?.osmType ?? null;
  const osmId = request?.osmId ?? null;
  const boundingBox = request?.boundingBox ?? null;

  return useQuery({
    queryKey: ["region", "boundary", gadmId, osmType, osmId, boundingBox],
    queryFn: () => fetchRegionBoundary({ gadmId, osmType, osmId, boundingBox }),
    enabled: !!(gadmId || (osmType && osmId) || boundingBox),
    staleTime: 60 * 60 * 1000,
  });
}
