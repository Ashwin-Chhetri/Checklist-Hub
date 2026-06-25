import { useQuery } from "@tanstack/react-query";
import { getChecklistMetadata } from "../services/metadataService";

export function useChecklistMetadata(checklistId: string) {
  return useQuery({
    queryKey: ["publication", "metadata", checklistId],
    queryFn: () => getChecklistMetadata(checklistId),
    enabled: !!checklistId,
  });
}
