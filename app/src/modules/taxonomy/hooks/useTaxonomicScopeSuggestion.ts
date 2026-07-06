"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TaxonomicScope } from "@/types/checklist.types";

export interface TaxonomicScopeSuggestion {
  matchedTerm: string;
  classification: TaxonomicScope;
}

/**
 * Debounced "does this checklist title imply a taxonomic scope?" lookup —
 * e.g. typing "Birds of Darjeeling" resolves to class Aves. Internally
 * debounces `title` itself (rather than requiring the caller to), since it's
 * meant to be wired directly to a raw text input's value.
 */
export function useTaxonomicScopeSuggestion(title: string) {
  const [debounced, setDebounced] = useState(title.trim());

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(title.trim()), 500);
    return () => clearTimeout(handle);
  }, [title]);

  return useQuery<TaxonomicScopeSuggestion | null>({
    queryKey: ["taxonomy", "suggest-scope", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/taxonomy/suggest-scope?title=${encodeURIComponent(debounced)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.matchedTerm || !data.classification) return null;
      const classification: TaxonomicScope = {};
      for (const [rank, name] of Object.entries(data.classification)) {
        if (typeof name === "string" && name) classification[rank as keyof TaxonomicScope] = name;
      }
      if (Object.keys(classification).length === 0) return null;
      return { matchedTerm: data.matchedTerm as string, classification };
    },
    enabled: debounced.length >= 3,
    staleTime: 60 * 1000,
  });
}
