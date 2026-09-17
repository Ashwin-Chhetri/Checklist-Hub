import { useTaxonGroupStats, type TaxonGroupStat } from "./useTaxonGroupStats";

export type FamilyStat = TaxonGroupStat;

/** Family-level view of useTaxonGroupStats — kept as its own hook since the
 * MapListDialog needs a top-level family count/loading check regardless of
 * whatever rank the List view's own wheel is currently drilled into. */
export function useFamilyStats(checklistId: string) {
  const { groups, isLoading } = useTaxonGroupStats(checklistId, "family");
  return { families: groups, isLoading };
}
