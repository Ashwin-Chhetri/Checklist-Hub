import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChecklistContributor, ChecklistMetadata } from "@/types/checklist.types";
import { saveChecklistMetadata } from "../services/metadataService";

export function useSaveChecklistMetadata(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      metadata,
      contributors,
    }: {
      metadata: Partial<ChecklistMetadata>;
      contributors: ChecklistContributor[];
    }) => saveChecklistMetadata(checklistId, metadata, contributors),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "metadata", checklistId] });
    },
  });
}
