import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicationDraftStage } from "@/types/checklist.types";
import {
  clearPublicationPackage,
  deleteChecklistMetadata,
  deletePublicationDraft,
  getPublicationDraft,
  savePublicationDraftStage,
} from "../services/publicationDraftService";

export function usePublicationDraft(checklistId: string) {
  return useQuery({
    queryKey: ["publication", "draft", checklistId],
    queryFn: () => getPublicationDraft(checklistId),
    enabled: !!checklistId,
  });
}

export function useSavePublicationDraftStage(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      stage,
      packageStoragePath,
      packageGeneratedAt,
    }: {
      stage: PublicationDraftStage;
      packageStoragePath?: string | null;
      packageGeneratedAt?: string | null;
    }) => savePublicationDraftStage(checklistId, stage, packageStoragePath, packageGeneratedAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "draft", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}

export function useDeletePublicationDraft(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deletePublicationDraft(checklistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "draft", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}

export function useDeleteChecklistMetadata(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteChecklistMetadata(checklistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "metadata", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["publication", "draft", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}

export function useClearPublicationPackage(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (storagePath: string | null) => clearPublicationPackage(checklistId, storagePath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "draft", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}
