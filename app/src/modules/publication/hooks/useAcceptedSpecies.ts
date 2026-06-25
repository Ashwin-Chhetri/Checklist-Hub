import { useQuery } from "@tanstack/react-query";
import { getAcceptedSpecies } from "../services/publicationService";

export function useAcceptedSpecies(checklistId: string) {
  return useQuery({
    queryKey: ["publication", "accepted-species", checklistId],
    queryFn: () => getAcceptedSpecies(checklistId),
    enabled: !!checklistId,
  });
}
