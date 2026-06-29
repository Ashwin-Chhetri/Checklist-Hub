"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getInatObservationPoints,
  resolveInatPlaceId,
  resolveInatTaxonId,
} from "@/modules/evidence/services/inaturalistEvidence";

interface RegionTextFields {
  region_name?: string | null;
  region_country?: string | null;
  region_state?: string | null;
  region_district?: string | null;
}

/**
 * Live iNaturalist occurrence coordinates for a species within the
 * checklist's region — fetched on demand (not persisted), for the Evidence
 * panel's region map. Resolves the region name → iNat place id and the
 * scientific name → iNat taxon id every call (both are cheap public-API
 * lookups, see inaturalistEvidence.ts).
 */
export function useInatOccurrences(scientificName: string | null | undefined, region: RegionTextFields) {
  const { region_name, region_country, region_state, region_district } = region;
  const placeQuery = region_district || region_name;
  return useQuery({
    queryKey: ["occurrences", "inaturalist", scientificName, placeQuery, region_state, region_country],
    queryFn: async () => {
      if (!scientificName || !placeQuery) return [];
      const placeId = await resolveInatPlaceId(placeQuery, region_state ?? undefined, region_country ?? undefined);
      if (placeId === null) return [];
      const taxonId = await resolveInatTaxonId(scientificName, "species");
      if (taxonId === null) return [];
      return getInatObservationPoints(taxonId, placeId);
    },
    enabled: !!scientificName && !!placeQuery,
    staleTime: 10 * 60 * 1000,
  });
}
