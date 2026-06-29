import { useCallback, useMemo, useState } from "react";
import type { ColumnFiltersState, SortingState, RowSelectionState } from "@tanstack/react-table";
import { useSpeciesList } from "@/modules/species/hooks/useSpecies";
import type { ReviewStatus, Species, TaxonomyStatus } from "@/types/species.types";

export type WorkbenchViewId =
  | "all"
  | "needs_review"
  | "synonyms"
  | "authority_conflicts"
  | "unresolved"
  | "accepted"
  | "rejected"
  | "merged";

const VIEW_FILTERS: Record<
  WorkbenchViewId,
  {
    review?: ReviewStatus;
    taxonomy?: TaxonomyStatus;
    activeOnly?: boolean;
    inactiveOnly?: boolean;
    /** Excludes rejected rows — a rejected species will never be published
     * (see publishRelevantRows in GET /api/checklists/[id]/validate), so its
     * taxonomy_status never needs resolving and it shouldn't keep showing up
     * as an outstanding synonym/conflict/unresolved issue once rejected. */
    excludeRejected?: boolean;
  }
> = {
  all:                  { activeOnly: true },
  needs_review:         { review: "not_reviewed", activeOnly: true },
  synonyms:             { taxonomy: "synonym", activeOnly: true, excludeRejected: true },
  authority_conflicts:  { taxonomy: "authority_conflict", activeOnly: true, excludeRejected: true },
  unresolved:           { taxonomy: "unresolved", activeOnly: true, excludeRejected: true },
  accepted:             { review: "accepted", activeOnly: true },
  rejected:             { review: "rejected", activeOnly: true },
  merged:               { inactiveOnly: true },
};

/**
 * Workbench table state: active sidebar view, sorting, column filters, and
 * row selection, layered on top of the species list query for a checklist.
 *
 * Default views filter to is_active = true only. The "Merged / Hidden" view
 * shows is_active = false rows for audit and undo purposes.
 */
export function useWorkbenchView(checklistId: string) {
  const speciesQuery = useSpeciesList(checklistId);
  const [activeView, setActiveViewRaw] = useState<WorkbenchViewId>("all");
  // Rows that resolved out of the active view's filter criteria (e.g. a synonym
  // merged into "accepted") stay visible — with their updated content — until
  // the user explicitly switches the view. Reset whenever the view changes.
  const [stickyIds, setStickyIds] = useState<Set<string>>(new Set());
  const setActiveView = useCallback((next: WorkbenchViewId) => {
    setStickyIds(new Set());
    setActiveViewRaw(next);
  }, []);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Priority used to pick the canonical row when multiple rows share a gbif_taxon_key.
  // The most-problematic status wins so conflicts/synonyms surface over "clean" accepted rows.
  const STATUS_PRIORITY: Record<string, number> = {
    authority_conflict: 4,
    synonym: 3,
    accepted: 2,
    unresolved: 1,
  };

  // Computed globally from the full (unfiltered) active species list so that
  // a taxon with both an authority_conflict and an accepted row always shows the
  // conflict row — even when the user is browsing the "accepted" view.
  //
  // Only rows that share a gbif_taxon_key WITH a genuine authority_conflict are
  // grouped/hidden here. Rows that merely share a gbif_taxon_key (e.g. a synonym
  // and its accepted counterpart, or two independently-resolved "accepted" rows)
  // are NOT a conflict needing resolution and must stay fully visible — hiding
  // them previously caused resolved rows to vanish from "All Species" and made
  // already-clean rows re-render as a fake "Conflict Found" once their status
  // changed to match a sibling's.
  const { nonCanonicalIds, relatedRowsByCanonical } = useMemo(() => {
    const all = speciesQuery.data ?? [];
    const active = all.filter((s) => s.is_active !== false);
    const byKey = new Map<number, Species[]>();
    for (const s of active) {
      if (!s.gbif_taxon_key) continue;
      const g = byKey.get(s.gbif_taxon_key) ?? [];
      g.push(s);
      byKey.set(s.gbif_taxon_key, g);
    }
    const nonCanonicalIds = new Set<string>();
    const relatedRowsByCanonical = new Map<string, Species[]>();
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const canonical = group.reduce((best, s) =>
        (STATUS_PRIORITY[s.taxonomy_status] ?? 0) > (STATUS_PRIORITY[best.taxonomy_status] ?? 0) ? s : best,
      );
      if (canonical.taxonomy_status !== "authority_conflict") continue;
      const others = group.filter((s) => s.id !== canonical.id);
      relatedRowsByCanonical.set(canonical.id, others);
      for (const s of others) nonCanonicalIds.add(s.id);
    }
    return { nonCanonicalIds, relatedRowsByCanonical };
  }, [speciesQuery.data]);

  const baseFilteredSpecies = useMemo(() => {
    const all = speciesQuery.data ?? [];
    const { review, taxonomy, activeOnly, inactiveOnly, excludeRejected } = VIEW_FILTERS[activeView];

    return all.filter((species) => {
      // is_active guard (default true when column doesn't exist yet in old DB)
      const isActive = species.is_active !== false;
      if (activeOnly && !isActive) return false;
      if (inactiveOnly && isActive) return false;
      if (review && species.review_status !== review) return false;
      if (taxonomy && species.taxonomy_status !== taxonomy) return false;
      if (excludeRejected && species.review_status === "rejected") return false;
      // Non-canonical rows are represented by their canonical partner — hide them in all views.
      if (nonCanonicalIds.has(species.id)) return false;
      return true;
    });
  }, [speciesQuery.data, activeView, nonCanonicalIds]);

  // Stamp stickiness for every row currently visible under the active view, so that
  // when a row's status changes and it no longer matches the filter, it keeps
  // rendering (with its new content) instead of vanishing mid-review. This follows
  // React's "adjusting state during render" pattern (guarded by a reference-equality
  // check against the previous baseFilteredSpecies) rather than an effect, so the
  // sticky set is up to date in the very render it needs to apply in.
  // Seeded with `null` (never equal to a real array) so the very first render also
  // stamps — initializing it to `baseFilteredSpecies` itself would make the mount
  // render a no-op match, leaving stickyIds empty until some unrelated refetch.
  const [seenBase, setSeenBase] = useState<typeof baseFilteredSpecies | null>(null);
  if (baseFilteredSpecies !== seenBase) {
    setSeenBase(baseFilteredSpecies);
    setStickyIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const s of baseFilteredSpecies) {
        if (!next.has(s.id)) {
          next.add(s.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  const filteredSpecies = useMemo(() => {
    if (stickyIds.size === 0) return baseFilteredSpecies;
    const all = speciesQuery.data ?? [];
    const baseIds = new Set(baseFilteredSpecies.map((s) => s.id));
    const stuck = all.filter((s) => stickyIds.has(s.id) && !baseIds.has(s.id) && s.is_active !== false);
    return stuck.length > 0 ? [...baseFilteredSpecies, ...stuck] : baseFilteredSpecies;
  }, [baseFilteredSpecies, stickyIds, speciesQuery.data]);

  const counts = useMemo(() => {
    const all = speciesQuery.data ?? [];
    // Count only canonical active rows so sidebar numbers match what the user sees.
    const active = all.filter((s) => s.is_active !== false && !nonCanonicalIds.has(s.id));
    // Rejected rows are excluded from the taxonomy-issue counts — same rule
    // as the "excludeRejected" view filter above and the publish validation
    // report: a rejected species never needs its taxonomy resolved.
    const unrejected = active.filter((s) => s.review_status !== "rejected");
    return {
      all: active.length,
      needs_review: active.filter((s) => s.review_status === "not_reviewed").length,
      synonyms: unrejected.filter((s) => s.taxonomy_status === "synonym").length,
      authority_conflicts: unrejected.filter((s) => s.taxonomy_status === "authority_conflict").length,
      unresolved: unrejected.filter((s) => s.taxonomy_status === "unresolved").length,
      accepted: active.filter((s) => s.review_status === "accepted").length,
      rejected: active.filter((s) => s.review_status === "rejected").length,
      merged: all.filter((s) => s.is_active === false).length,
    };
  }, [speciesQuery.data, nonCanonicalIds]);

  return {
    species: filteredSpecies,
    counts,
    relatedRowsByCanonical,
    isLoading: speciesQuery.isLoading,
    activeView,
    setActiveView,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    rowSelection,
    setRowSelection,
  };
}
