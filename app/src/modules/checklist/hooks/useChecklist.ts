import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Checklist } from "@/types/checklist.types";
import { isValidEmailFormat } from "@/lib/validation/email";
import {
  getChecklist,
  getChecklistCollaborators,
  inviteCollaborator,
  listChecklistInvites,
  lookupEmail,
  removeCollaborator,
  searchProfiles,
  updateChecklist,
} from "../services/checklistService";

/** Type-ahead search of existing Checklist Hub members by name/email, for invite UIs. */
export function useProfileSearch(query: string, excludeIds: string[] = []) {
  return useQuery({
    queryKey: ["profiles", "search", query, excludeIds],
    queryFn: () => searchProfiles(query, excludeIds),
    enabled: query.trim().length > 0,
  });
}

/**
 * Authoritative "is this exact email invitable" check for the new-email
 * branch of invite UIs: debounced (matches the pattern in RegionInput),
 * then asks `/api/users/email-lookup` whether it's an existing account or,
 * if not, whether the domain can receive mail at all.
 */
export function useEmailLookup(email: string) {
  const [debouncedEmail, setDebouncedEmail] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedEmail(email.trim()), 500);
    return () => clearTimeout(handle);
  }, [email]);

  return useQuery({
    queryKey: ["email-lookup", debouncedEmail],
    queryFn: () => lookupEmail(debouncedEmail),
    enabled: isValidEmailFormat(debouncedEmail),
  });
}

export function useChecklist(checklistId: string) {
  return useQuery({
    queryKey: ["checklists", checklistId],
    queryFn: () => getChecklist(checklistId),
    enabled: !!checklistId,
  });
}

export function useChecklistCollaborators(checklistId: string) {
  return useQuery({
    queryKey: ["checklists", checklistId, "collaborators"],
    queryFn: () => getChecklistCollaborators(checklistId),
    enabled: !!checklistId,
  });
}

export function useUpdateChecklist(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      updates: Partial<
        Pick<
          Checklist,
          | "title"
          | "region_name"
          | "region_district"
          | "region_state"
          | "region_country"
          | "region_gadm_id"
          | "region_osm_type"
          | "region_osm_id"
          | "region_pin"
          | "taxonomic_scope"
        >
      >,
    ) => updateChecklist(checklistId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId] });
    },
  });
}

export function useChecklistInvites(checklistId: string) {
  return useQuery({
    queryKey: ["checklists", checklistId, "invites"],
    queryFn: () => listChecklistInvites(checklistId),
    enabled: !!checklistId,
  });
}

export function useRemoveCollaborator(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => removeCollaborator(checklistId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "collaborators"] });
    },
  });
}

export function useInviteCollaborator(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { email: string; note?: string }) => inviteCollaborator(checklistId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "invites"] });
      queryClient.invalidateQueries({ queryKey: ["checklists", checklistId, "collaborators"] });
    },
  });
}
