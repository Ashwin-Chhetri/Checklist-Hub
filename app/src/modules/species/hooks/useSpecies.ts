import { useQuery } from "@tanstack/react-query";
import { getSpecies, listSpecies } from "../services/speciesService";

export function useSpeciesList(checklistId: string) {
  return useQuery({
    queryKey: ["species", "list", checklistId],
    queryFn: () => listSpecies(checklistId),
    enabled: !!checklistId,
    staleTime: 15_000,
  });
}

export function useSpecies(speciesId: string) {
  return useQuery({
    queryKey: ["species", "detail", speciesId],
    queryFn: () => getSpecies(speciesId),
    enabled: !!speciesId,
  });
}
