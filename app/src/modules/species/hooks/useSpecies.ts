import { useQuery } from "@tanstack/react-query";
import { getSpecies, listSpecies } from "../services/speciesService";

export function useSpeciesList(checklistId: string) {
  return useQuery({
    queryKey: ["species", "list", checklistId],
    queryFn: () => listSpecies(checklistId),
    enabled: !!checklistId,
    staleTime: 15_000,
    // Force a fresh fetch every time the workbench (re)mounts — e.g. landing
    // here from the publish-readiness dialog, which always queries the DB
    // directly. Without this, remounting within staleTime reuses whatever
    // snapshot was cached before navigating away, so the sidebar's taxonomy
    // issue counts can silently disagree with what the dialog just showed.
    refetchOnMount: "always",
  });
}

export function useSpecies(speciesId: string) {
  return useQuery({
    queryKey: ["species", "detail", speciesId],
    queryFn: () => getSpecies(speciesId),
    enabled: !!speciesId,
  });
}
