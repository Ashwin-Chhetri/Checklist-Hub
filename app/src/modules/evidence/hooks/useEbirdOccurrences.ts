"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getEbirdObservationPoints,
  isEbirdConfigured,
  resolveEbirdRegionCode,
  resolveEbirdSpeciesCode,
} from "@/modules/evidence/services/ebirdEvidence";

interface RegionTextFields {
  region_country?: string | null;
  region_state?: string | null;
  region_district?: string | null;
}

/**
 * Live eBird occurrence coordinates for a species within the checklist's
 * region — fetched on demand (not persisted), for the Evidence panel's
 * region map. Resolves the region name → eBird region code and the
 * scientific name → eBird speciesCode every call (both are cheap/cached
 * lookups, see ebirdEvidence.ts) rather than requiring those ids to already
 * be stored on the species/checklist. Gracefully returns [] for non-birds or
 * unresolvable regions, same degrade-gracefully convention as the rest of
 * the eBird client.
 */
export function useEbirdOccurrences(
  scientificName: string | null | undefined,
  region: RegionTextFields,
  options?: { enabled?: boolean },
) {
  const { region_country, region_state, region_district } = region;
  const enabled = options?.enabled ?? true;
  return useQuery({
    queryKey: ["occurrences", "ebird", scientificName, region_country, region_state, region_district],
    queryFn: async () => {
      if (!scientificName || !region_country || !region_state || !region_district) return [];
      const regionCode = await resolveEbirdRegionCode({ region_country, region_state, region_district });
      if (!regionCode) return [];
      const speciesCode = await resolveEbirdSpeciesCode(scientificName);
      if (!speciesCode) return [];
      return getEbirdObservationPoints(speciesCode, regionCode);
    },
    enabled: enabled && !!scientificName && isEbirdConfigured(),
    staleTime: 10 * 60 * 1000,
  });
}
