import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReviewStatus } from "@/types/species.types";
import { bulkUpdateReviewStatus } from "../services/speciesService";
import { patchSpeciesInListMany } from "../utils/patchSpeciesCache";

export function useBulkUpdateSpeciesStatus(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ speciesIds, reviewStatus }: { speciesIds: string[]; reviewStatus: ReviewStatus }) =>
      bulkUpdateReviewStatus(speciesIds, reviewStatus),
    onSuccess: (_data, { speciesIds, reviewStatus }) => {
      patchSpeciesInListMany(queryClient, checklistId, speciesIds, (s) => ({ ...s, review_status: reviewStatus }));
    },
  });
}
