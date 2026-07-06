import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateChecklistInput } from "@/types/checklist.types";
import { createChecklist, type CreateChecklistProgress } from "../services/checklistService";

export interface CreateChecklistVariables {
  input: CreateChecklistInput;
  /** Called after the initial create and after every species append batch — lets the wizard show live progress for large (10k+ species) checklists instead of a bare spinner. */
  onProgress?: (progress: CreateChecklistProgress) => void;
}

export function useCreateChecklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ input, onProgress }: CreateChecklistVariables) => createChecklist(input, onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}
