import { useMutation, useQueryClient } from "@tanstack/react-query";

async function enrichTaxonomy(checklistId: string, speciesId: string) {
  const res = await fetch(`/api/checklists/${checklistId}/species/${speciesId}/enrich-taxonomy`, {
    method: "POST",
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? "Failed to enrich taxonomy.");
  }
  return res.json() as Promise<{ ok: true; changed: boolean }>;
}

/**
 * On-demand, persisted fallback for a species row whose taxonomy hierarchy/
 * authority/year is still incomplete after ingestion — see
 * enrichSpeciesTaxonomy.server.ts. Meant to be called once when a gap is
 * detected (not on every render); on success the species list/detail
 * queries are invalidated so the row re-renders from the now-persisted data.
 */
export function useEnrichTaxonomy(checklistId: string, speciesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => enrichTaxonomy(checklistId, speciesId),
    onSuccess: (result) => {
      if (!result.changed) return;
      queryClient.invalidateQueries({ queryKey: ["species", "list", checklistId] });
      queryClient.invalidateQueries({ queryKey: ["species", "detail", speciesId] });
    },
  });
}
