import { useQuery } from "@tanstack/react-query";
import { getPublicationReadiness } from "../services/publicationService";

export function usePublicationReadiness(checklistId: string) {
  return useQuery({
    queryKey: ["publication", "readiness", checklistId],
    queryFn: () => getPublicationReadiness(checklistId),
    enabled: !!checklistId,
  });
}
