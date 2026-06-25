import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listMyPublishingOrganizations,
  setChecklistPublishingOrganization,
  upsertPublishingOrganization,
  type PublishingOrganizationInput,
} from "../services/publishingOrganizationService";

export function useMyPublishingOrganizations() {
  return useQuery({
    queryKey: ["publication", "organizations"],
    queryFn: listMyPublishingOrganizations,
  });
}

export function useUpsertPublishingOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PublishingOrganizationInput) => upsertPublishingOrganization(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "organizations"] });
    },
  });
}

export function useSetChecklistPublishingOrganization(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (organizationId: string | null) => setChecklistPublishingOrganization(checklistId, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "metadata", checklistId] });
    },
  });
}
