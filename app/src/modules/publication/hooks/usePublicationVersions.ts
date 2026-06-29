import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPublicationVersion, listPublicationVersions } from "../services/publicationVersionsService";

export function usePublicationVersions(checklistId: string) {
  return useQuery({
    queryKey: ["publication", "versions", checklistId],
    queryFn: () => listPublicationVersions(checklistId),
    enabled: !!checklistId,
  });
}

export function useCreatePublicationVersion(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPublicationVersion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "versions", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["publication", "comments", checklistId] });
    },
  });
}
