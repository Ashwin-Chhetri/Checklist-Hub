import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReviewStatus } from "@/types/species.types";
import { updateReviewStatus } from "../services/speciesService";
import { patchSpeciesInList } from "../utils/patchSpeciesCache";

export function useUpdateSpeciesStatus(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ speciesId, reviewStatus }: { speciesId: string; reviewStatus: ReviewStatus }) =>
      updateReviewStatus(speciesId, reviewStatus),
    onSuccess: (_data, { speciesId, reviewStatus }) => {
      patchSpeciesInList(queryClient, checklistId, speciesId, (s) => ({ ...s, review_status: reviewStatus }));
    },
  });
}
