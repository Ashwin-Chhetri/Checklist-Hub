import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteChecklist } from "../services/checklistService";

export function useDeleteChecklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteChecklist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}
