import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applySpeciesEdits, type SpeciesEditUpdate } from "../services/speciesEditService";

export function useApplySpeciesEdits(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates: SpeciesEditUpdate[]) => applySpeciesEdits(checklistId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "accepted-species", checklistId] });
    },
  });
}
