import { useMemo } from "react";
import type { Species } from "@/types/species.types";
import { useSpeciesList } from "./useSpecies";

export interface TaxonGroupStat {
  name: string;
  species: number;
  occurrences: number;
  /** GBIF taxon keys of a representative sample of this group's species —
   * up to MAX_SAMPLE_SPECIES, ranked by highest region-scoped occurrence
   * count, among species that have a resolved taxon key. Backs both the
   * sidebar thumbnail carousel and (for whichever group is selected) the
   * region map's occurrence points. Empty when no species in the group
   * resolved a taxon key. At the "species" rank each group is a single
   * checklist row, so this holds at most that one species' own key. */
  sampleTaxonKeys: number[];
}

const MAX_SAMPLE_SPECIES = 10;

// "species" is the terminal rank — a species-level group is a single
// checklist row, not a further grouping, so there's nowhere left to drill.
export type TaxonGroupRank = "family" | "genus" | "species";

export interface TaxonGroupParent {
  rank: TaxonGroupRank;
  name: string;
}

function fieldForRank(s: Species, rank: TaxonGroupRank): string | null | undefined {
  if (rank === "family") return s.family;
  if (rank === "genus") return s.genus;
  return s.scientific_name;
}

/**
 * Groups a checklist's active species by the given taxonomic rank, optionally
 * narrowed to a single parent group first (e.g. genus-level stats within one
 * family, or species-level stats within one genus) — generalizes what
 * useFamilyStats always did at the family level alone, so the List view's
 * wheel can drill all the way down to individual species. No extra network
 * calls — `useSpeciesList` already loads every field this needs, so this is
 * a pure client-side aggregation of data the workbench already has in
 * memory.
 */
export function useTaxonGroupStats(checklistId: string, rank: TaxonGroupRank, parent?: TaxonGroupParent | null) {
  const speciesQuery = useSpeciesList(checklistId);
  // Destructured to primitives so useMemo's dependency array can compare by
  // value — callers (e.g. FamilyListView) construct a new `parent` object
  // literal on every render, which would otherwise defeat the memo entirely.
  const parentRank = parent?.rank;
  const parentName = parent?.name;

  const groups = useMemo<TaxonGroupStat[]>(() => {
    interface Building {
      name: string;
      species: number;
      occurrences: number;
      candidates: { taxonKey: number; occ: number }[];
    }
    const byGroup = new Map<string, Building>();
    for (const s of speciesQuery.data ?? []) {
      if (s.is_active === false) continue;
      if (parentRank != null && parentName != null) {
        const parentVal = fieldForRank(s, parentRank)?.trim() || "Unclassified";
        if (parentVal !== parentName) continue;
      }
      const raw = fieldForRank(s, rank);
      const name = raw?.trim() || "Unclassified";
      const entry = byGroup.get(name) ?? { name, species: 0, occurrences: 0, candidates: [] };
      entry.species += 1;
      const occ = s.evidence?.occurrence_count ?? 0;
      entry.occurrences += occ;
      if (s.gbif_taxon_key != null) entry.candidates.push({ taxonKey: s.gbif_taxon_key, occ });
      byGroup.set(name, entry);
    }
    return Array.from(byGroup.values())
      .map(({ candidates, ...rest }) => ({
        ...rest,
        sampleTaxonKeys: candidates
          .sort((a, b) => b.occ - a.occ)
          .slice(0, MAX_SAMPLE_SPECIES)
          .map((c) => c.taxonKey),
      }))
      .sort((a, b) => b.species - a.species);
  }, [speciesQuery.data, rank, parentRank, parentName]);

  return { groups, isLoading: speciesQuery.isLoading };
}
