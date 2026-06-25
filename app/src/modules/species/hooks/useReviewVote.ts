import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useReviewVote(checklistId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      speciesId,
      decision,
    }: {
      speciesId: string;
      decision: "accept" | "reject" | "agree" | "disagree";
    }) => {
      const res = await fetch(
        `/api/checklists/${checklistId}/species/${speciesId}/review-vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
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
