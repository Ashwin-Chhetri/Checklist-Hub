import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchSpeciesInList } from "@/modules/species/utils/patchSpeciesCache";
import type { Species } from "@/types/species.types";

async function resolveTaxonomy(checklistId: string, speciesId: string, decision: "agree" | "disagree" | "defer") {
  const res = await fetch(`/api/checklists/${checklistId}/species/${speciesId}/resolve-taxonomy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? "Failed to resolve taxonomy.");
  }
  return res.json();
}

export function useResolveTaxonomy(checklistId: string, speciesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decision: "agree" | "disagree" | "defer") => resolveTaxonomy(checklistId, speciesId, decision),
    onMutate: async (decision) => {
      const previous = queryClient.getQueryData<Species[]>(["species", "list", checklistId]);
      if (decision !== "defer") {
        patchSpeciesInList(queryClient, checklistId, speciesId, (s) => ({
          ...s,
          taxonomy_status: "accepted",
          taxonomy: {
            ...s.taxonomy,
            name_resolution: {
              decision,
              resolved_by: "",
              resolved_at: new Date().toISOString(),
            },
          },
        }));
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["species", "list", checklistId], context.previous);
      }
    },
    onSuccess: () => {
      // No ["species","list",...] invalidation — the RPC's UPDATE to species
      // fires the existing realtime postgres_changes subscription
      // (useChecklistRealtimeChannel), which patches the row directly.
      queryClient.invalidateQueries({ queryKey: ["species", "detail", speciesId] });
    },
  });
}
