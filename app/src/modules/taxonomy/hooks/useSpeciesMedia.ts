"use client";

import { useQuery } from "@tanstack/react-query";
import type { SpeciesMediaItem } from "@/app/api/taxonomy/species-media/route";

export function useSpeciesMedia(taxonKey: number | null | undefined) {
  return useQuery<SpeciesMediaItem[]>({
    queryKey: ["species-media", taxonKey],
    queryFn: async () => {
      const res = await fetch(`/api/taxonomy/species-media?taxonKey=${taxonKey}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.media ?? [];
    },
    enabled: !!taxonKey,
    staleTime: 10 * 60 * 1000,
  });
}
