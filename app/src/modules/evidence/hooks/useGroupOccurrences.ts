"use client";

import { useQuery } from "@tanstack/react-query";
import { getOccurrenceCoordinatesForTaxa } from "@/modules/evidence/services/gbifEvidence";

/**
 * Live GBIF occurrence coordinates for a whole taxonomic GROUP (a family's
 * or genus's sample species), for the List view's region hub map — plots
 * "where this selection actually occurs" rather than a single species' own
 * occurrences (see useSpeciesOccurrences for that case).
 */
export function useGroupOccurrences(taxonKeys: number[], gadmGid: string | null | undefined) {
  const sortedKeys = [...taxonKeys].sort((a, b) => a - b);
  return useQuery({
    queryKey: ["group-occurrences", sortedKeys, gadmGid],
    queryFn: () => getOccurrenceCoordinatesForTaxa(taxonKeys, gadmGid ?? undefined),
    enabled: taxonKeys.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}
