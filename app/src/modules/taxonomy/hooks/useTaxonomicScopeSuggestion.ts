"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CoreRankName, RankName } from "@/lib/taxonomy/ranks";
import type { ScopeNode, TaxonomicScope } from "@/types/checklist.types";

export interface TaxonomicScopeSuggestion {
  matchedTerm: string;
  /** The seven principal ranks, for the breadcrumb banner. */
  classification: TaxonomicScope;
  /** The full suggested scope, including sub-ranks and any exclusions. */
  nodes: ScopeNode[];
  /** Optional rank rows the suggestion needs the selector to show. */
  enabledRanks: RankName[];
  /**
   * Set when the suggestion encodes a group that isn't a clade (e.g. moths),
   * explaining the exclusion so it doesn't look like a mistake.
   */
  note: string | null;
}

/**
 * Debounced "does this checklist title imply a taxonomic scope?" lookup —
 * e.g. typing "Butterflies of Darjeeling" resolves to order Lepidoptera plus
 * superfamily Papilionoidea. Internally debounces `title` itself (rather than
 * requiring the caller to), since it's meant to be wired directly to a raw
 * text input's value.
 */
export function useTaxonomicScopeSuggestion(title: string) {
  const [debounced, setDebounced] = useState(title.trim());

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(title.trim()), 300);
    return () => clearTimeout(handle);
  }, [title]);

  return useQuery<TaxonomicScopeSuggestion | null>({
    queryKey: ["taxonomy", "suggest-scope", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/taxonomy/suggest-scope?title=${encodeURIComponent(debounced)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.matchedTerm) return null;

      const nodes = (data.nodes ?? []) as ScopeNode[];
      if (!nodes.some((n) => n.mode === "include")) return null;

      const classification: TaxonomicScope = {};
      for (const [rank, name] of Object.entries(data.classification ?? {})) {
        if (typeof name === "string" && name) classification[rank as CoreRankName] = name;
      }

      return {
        matchedTerm: data.matchedTerm as string,
        classification: { ...classification, nodes },
        nodes,
        enabledRanks: (data.enabledRanks ?? []) as RankName[],
        note: (data.note ?? null) as string | null,
      };
    },
    enabled: debounced.length >= 3,
    staleTime: 60 * 1000,
  });
}
