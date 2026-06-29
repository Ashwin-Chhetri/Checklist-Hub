import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { ReviewDecision } from "@/types/collaboration.types";

interface AuthorityVoteInput {
  speciesId: string;
  reviewerId: string;
  decision: Extract<ReviewDecision, "agree" | "disagree">;
  /** Identifies which taxonomy authority/synonym suggestion this vote applies to. */
  target: Record<string, unknown>;
  note?: string;
}

/**
 * Records an expert's agree/disagree vote on a taxonomy authority conflict
 * or synonym suggestion (workbench taxonomy panel "Resolution Summary").
 */
export function useAuthorityVote(checklistId: string) {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({ speciesId, reviewerId, decision, target }: AuthorityVoteInput) => {
      // Look up the taxonomy_conflicts row matching this authority+name so we can
      // write to the normalized taxonomy_votes table (which enforces one vote per voter per conflict).
      const { data: conflict, error: lookupError } = await supabase
        .from("taxonomy_conflicts")
        .select("id")
        .eq("species_id", speciesId)
        .eq("authority", target.authority as string)
        .eq("suggested_name", target.suggested_name as string)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (!conflict) {
        // No DB conflict row yet (conflict only in JSONB snapshot); nothing to vote on.
        return;
      }

      const { error } = await supabase
        .from("taxonomy_votes")
        .upsert(
          { conflict_id: conflict.id, voter_id: reviewerId, decision },
          { onConflict: "conflict_id,voter_id" },
        );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["taxonomy", "panel", variables.speciesId] });
      queryClient.invalidateQueries({ queryKey: ["species", "list", checklistId] });
    },
  });
}
