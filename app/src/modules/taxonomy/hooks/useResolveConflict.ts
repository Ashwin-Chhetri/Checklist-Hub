import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchSpeciesInList } from "@/modules/species/utils/patchSpeciesCache";
import type { Species } from "@/types/species.types";

async function resolveConflict(
  checklistId: string,
  speciesId: string,
  authority: string,
  suggested_name: string,
) {
  const res = await fetch(`/api/checklists/${checklistId}/species/${speciesId}/resolve-conflict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authority, suggested_name }),
  });
  if (!res.ok) {
    const { error } = (await res.json()) as { error: string };
    throw new Error(error ?? "Failed to resolve conflict.");
  }
  return res.json();
}

export function useResolveConflict(checklistId: string, speciesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ authority, suggested_name }: { authority: string; suggested_name: string }) =>
      resolveConflict(checklistId, speciesId, authority, suggested_name),
    onMutate: async ({ suggested_name }) => {
      const previous = queryClient.getQueryData<Species[]>(["species", "list", checklistId]);
      patchSpeciesInList(queryClient, checklistId, speciesId, (s) => ({
        ...s,
        scientific_name: suggested_name,
        taxonomy_status: "accepted",
      }));
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
