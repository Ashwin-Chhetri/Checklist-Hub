"use client";

import { useQuery } from "@tanstack/react-query";

export interface TaxonomySuggestion {
  taxonId: number;
  scientificName: string | null;
  canonicalName: string | null;
  authorship: string | null;
  year: number | null;
  rank: string | null;
  taxonomicStatus: string | null;
  commonName: string | null;
  classification: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
  };
}

/**
 * Type-ahead suggestions against the local GBIF backbone mirror, for the
 * manual taxonomy edit form's scientific-name field. `query` should already
 * be debounced by the caller — this hook just gates the fetch on length.
 */
export function useTaxonomySuggest(query: string) {
  const trimmed = query.trim();
  return useQuery<TaxonomySuggestion[]>({
    queryKey: ["taxonomy", "suggest", trimmed],
    queryFn: async () => {
      const res = await fetch(`/api/taxonomy/suggest?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.suggestions ?? [];
    },
    enabled: trimmed.length >= 2,
    staleTime: 60 * 1000,
  });
}
