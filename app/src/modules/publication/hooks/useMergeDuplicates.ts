import { useMutation, useQueryClient } from "@tanstack/react-query";

interface MergeDuplicatesResult {
  ok: boolean;
  merged_groups: { gbif_taxon_key: number; canonical_species_id: string; merged_species_ids: string[] }[];
}

async function mergeDuplicates(checklistId: string): Promise<MergeDuplicatesResult> {
  const response = await fetch(`/api/checklists/${checklistId}/validate/merge-duplicates`, { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to merge duplicates.");
  }
  return response.json();
}

export function useMergeDuplicates(checklistId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => mergeDuplicates(checklistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["publication", "readiness", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["species", "list", checklistId] });
    },
  });
}
