import { useQuery } from "@tanstack/react-query";
import { countOwnedChecklists, listChecklists } from "../services/checklistService";

export function useChecklists() {
  return useQuery({
    queryKey: ["checklists"],
    queryFn: listChecklists,
  });
}

/** Number of checklists this user has created (owns) — see countOwnedChecklists. */
export function useOwnedChecklistCount(ownerId: string | undefined) {
  return useQuery({
    queryKey: ["checklists", "owned-count", ownerId],
    queryFn: () => countOwnedChecklists(ownerId!),
    enabled: !!ownerId,
  });
}
