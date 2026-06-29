"use client";

import { useQuery } from "@tanstack/react-query";
import { getOccurrenceCoordinates } from "@/modules/evidence/services/gbifEvidence";

/**
 * Live GBIF occurrence coordinates for a species within the checklist's
 * region — fetched on demand (not persisted), for the Evidence panel's
 * region map. GBIF-only: see plan notes on scope for v1.
 */
export function useSpeciesOccurrences(taxonKey: number | null | undefined, gadmGid: string | null | undefined) {
  return useQuery({
    queryKey: ["occurrences", taxonKey, gadmGid],
    queryFn: () => getOccurrenceCoordinates(taxonKey as number, gadmGid ?? undefined),
    enabled: !!taxonKey,
    staleTime: 10 * 60 * 1000,
  });
}
