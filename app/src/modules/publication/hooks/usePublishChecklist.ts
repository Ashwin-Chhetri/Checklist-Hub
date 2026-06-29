import { useMutation, useQueryClient } from "@tanstack/react-query";
import { markChecklistSubmittedForReview, publishChecklist } from "../services/publicationService";

export function usePublishChecklist(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => publishChecklist(checklistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      queryClient.invalidateQueries({ queryKey: ["publication", "history", checklistId] });
    },
  });
}

export function useMarkSubmittedForReview(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => markChecklistSubmittedForReview(checklistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      queryClient.invalidateQueries({ queryKey: ["publication", "metadata", checklistId] });
    },
  });
}
