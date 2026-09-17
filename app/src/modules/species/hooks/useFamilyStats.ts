import { useMemo } from "react";
import { useSpeciesList } from "./useSpecies";

export interface FamilyStat {
  name: string;
  species: number;
  occurrences: number;
  /** GBIF taxon key of the family's top species (highest region-scoped
   * occurrence count among species that have a resolved taxon key) — used to
   * fetch a representative thumbnail image for the family. Null when no
   * species in the family has a resolved taxon key (e.g. the synthetic
   * "Other families" bucket). */
  topSpeciesTaxonKey: number | null;
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
    // Tracks the occurrence count backing each family's current
    // topSpeciesTaxonKey pick, separately from `occurrences` above (which is
    // a running sum across the whole family, not a per-species max).
    const bestOccByFamily = new Map<string, number>();
    for (const s of speciesQuery.data ?? []) {
      if (s.is_active === false) continue;
      const name = s.family?.trim() || "Unclassified";
      const entry = byFamily.get(name) ?? { name, species: 0, occurrences: 0, topSpeciesTaxonKey: null };
      entry.species += 1;
      const occ = s.evidence?.occurrence_count ?? 0;
      entry.occurrences += occ;
      const bestOcc = bestOccByFamily.get(name) ?? -1;
      if (s.gbif_taxon_key != null && occ > bestOcc) {
        bestOccByFamily.set(name, occ);
        entry.topSpeciesTaxonKey = s.gbif_taxon_key;
      }
      byFamily.set(name, entry);
    }
    return Array.from(byFamily.values()).sort((a, b) => b.species - a.species);
  }, [speciesQuery.data]);

  return { families, isLoading: speciesQuery.isLoading };
}
