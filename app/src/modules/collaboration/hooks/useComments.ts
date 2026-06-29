import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listComments, listRecentComments, postComment, updateComment } from "../services/commentsService";
import { listActivity } from "../services/activityService";

export function useComments(speciesId: string) {
  return useQuery({
    queryKey: ["comments", speciesId],
    queryFn: () => listComments(speciesId),
    enabled: !!speciesId,
  });
}

export function usePostComment(speciesId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", speciesId] });
    },
  });
}

export function useUpdateComment(speciesId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", speciesId] });
    },
  });
}

export function useRecentComments(checklistId: string, limit = 20, enabled = true) {
  return useQuery({
    queryKey: ["checklists", checklistId, "recent-comments"],
    queryFn: () => listRecentComments(checklistId, limit),
    enabled: !!checklistId && enabled,
  });
}

export function useActivity(
  checklistId: string,
  options: { actions?: string[]; limit?: number; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["checklists", checklistId, "activity", options.actions ?? "all"],
    queryFn: () => listActivity(checklistId, options),
    enabled: !!checklistId && (options.enabled ?? true),
  });
}
