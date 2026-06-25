"use client";

import { useQuery } from "@tanstack/react-query";

export interface SubspeciesItem {
  taxon_id: number;
  scientific_name: string | null;
  vernacular_name: string | null;
}

export function useSubspecies(taxonKey: number | null | undefined) {
  return useQuery<SubspeciesItem[]>({
    queryKey: ["subspecies", taxonKey],
    queryFn: async () => {
      const res = await fetch(`/api/taxonomy/subspecies?taxonKey=${taxonKey}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.subspecies ?? [];
    },
    enabled: !!taxonKey,
    staleTime: 30 * 60 * 1000,
  });
}
