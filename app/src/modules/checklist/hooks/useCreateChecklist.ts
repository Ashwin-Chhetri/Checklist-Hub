import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createChecklist } from "../services/checklistService";

export function useCreateChecklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createChecklist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}
