import { useMemo } from "react";
import { useSpeciesList } from "./useSpecies";

export interface FamilyStat {
  name: string;
  species: number;
  occurrences: number;
}

/**
 * Groups a checklist's active species by family, summing each species'
 * region-scoped occurrence total (`evidence.occurrence_count`, already
 * rolled up across GBIF/eBird/iNaturalist/literature by the discovery
 * pipeline). No extra network calls — `useSpeciesList` already loads every
 * field this needs, so this is a pure client-side aggregation of data the
 * workbench table already has in memory.
 */
export function useFamilyStats(checklistId: string) {
  const speciesQuery = useSpeciesList(checklistId);

  const families = useMemo<FamilyStat[]>(() => {
    const byFamily = new Map<string, FamilyStat>();
    for (const s of speciesQuery.data ?? []) {
      if (s.is_active === false) continue;
      const name = s.family?.trim() || "Unclassified";
      const entry = byFamily.get(name) ?? { name, species: 0, occurrences: 0 };
      entry.species += 1;
      entry.occurrences += s.evidence?.occurrence_count ?? 0;
      byFamily.set(name, entry);
    }
    return Array.from(byFamily.values()).sort((a, b) => b.species - a.species);
  }, [speciesQuery.data]);

  return { families, isLoading: speciesQuery.isLoading };
}
