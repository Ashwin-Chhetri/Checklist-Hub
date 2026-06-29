import { useQuery } from "@tanstack/react-query";
import { getPublicationHistory } from "../services/publicationService";

export function usePublicationHistory(checklistId: string) {
  return useQuery({
    queryKey: ["publication", "history", checklistId],
    queryFn: () => getPublicationHistory(checklistId),
    enabled: !!checklistId,
  });
}
