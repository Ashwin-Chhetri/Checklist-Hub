"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRegionBoundary, type RegionBoundaryRequest } from "@/modules/checklist/services/regionApi";

/** A region's boundary never changes — cache effectively for the session. */
export function useRegionBoundary(request: RegionBoundaryRequest | null | undefined) {
  const gadmId = request?.gadmId ?? null;
  const osmType = request?.osmType ?? null;
  const osmId = request?.osmId ?? null;
  const boundingBox = request?.boundingBox ?? null;
  const district = request?.district ?? null;
  const state = request?.state ?? null;
  const country = request?.country ?? null;

  return useQuery({
    queryKey: ["region", "boundary", gadmId, osmType, osmId, boundingBox, district, state, country],
    queryFn: () => fetchRegionBoundary({ gadmId, osmType, osmId, boundingBox, district, state, country }),
    enabled: !!((district && country) || gadmId || (osmType && osmId) || boundingBox),
    staleTime: 60 * 60 * 1000,
  });
}
