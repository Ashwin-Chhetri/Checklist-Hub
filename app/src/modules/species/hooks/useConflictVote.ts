import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useConflictVote(checklistId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      speciesId,
      authority,
      suggested_name,
    }: {
      speciesId: string;
      authority: string;
      suggested_name: string;
    }) => {
      const res = await fetch(
        `/api/checklists/${checklistId}/species/${speciesId}/conflict-vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authority, suggested_name }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to cast vote");
      }
      return res.json();
    },
    onSuccess: () => {
      // Don't invalidate the species list here — it can be tens of thousands of
      // rows. If a vote ever changes a species' taxonomy/review status, the
      // realtime `species` postgres_changes event patches that row directly.
      qc.invalidateQueries({ queryKey: ["checklist-votes", checklistId] });
    },
  });
}
