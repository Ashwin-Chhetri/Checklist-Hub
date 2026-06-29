import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listPublicationComments, postPublicationComment } from "../services/publicationCommentsService";

export function usePublicationComments(checklistId: string) {
  return useQuery({
    queryKey: ["publication", "comments", checklistId],
    queryFn: () => listPublicationComments(checklistId),
    enabled: !!checklistId,
  });
}

export function usePostPublicationComment(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postPublicationComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "comments", checklistId] });
    },
  });
}
