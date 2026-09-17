import { useMemo } from "react";
import { useSpeciesList } from "./useSpecies";

export interface FamilyStat {
  name: string;
  species: number;
  occurrences: number;
  /** GBIF taxon keys of a representative sample of this family's species —
   * up to MAX_SAMPLE_SPECIES, ranked by highest region-scoped occurrence
   * count, among species that have a resolved taxon key — used to show a
   * handful of photos representative of the family. Empty for the synthetic
   * "Other families" bucket, or when no species in the family resolved a
   * taxon key. */
  sampleTaxonKeys: number[];
}

const MAX_SAMPLE_SPECIES = 4;

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
    interface Building {
      name: string;
      species: number;
      occurrences: number;
      candidates: { taxonKey: number; occ: number }[];
    }
    const byFamily = new Map<string, Building>();
    for (const s of speciesQuery.data ?? []) {
      if (s.is_active === false) continue;
      const name = s.family?.trim() || "Unclassified";
      const entry = byFamily.get(name) ?? { name, species: 0, occurrences: 0, candidates: [] };
      entry.species += 1;
      const occ = s.evidence?.occurrence_count ?? 0;
      entry.occurrences += occ;
      if (s.gbif_taxon_key != null) entry.candidates.push({ taxonKey: s.gbif_taxon_key, occ });
      byFamily.set(name, entry);
    }
    return Array.from(byFamily.values())
      .map(({ candidates, ...rest }) => ({
        ...rest,
        sampleTaxonKeys: candidates
          .sort((a, b) => b.occ - a.occ)
          .slice(0, MAX_SAMPLE_SPECIES)
          .map((c) => c.taxonKey),
      }))
      .sort((a, b) => b.species - a.species);
  }, [speciesQuery.data]);

  return { families, isLoading: speciesQuery.isLoading };
}
