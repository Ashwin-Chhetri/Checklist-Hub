import { useQuery } from "@tanstack/react-query";

export interface VoterProfile {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface ConflictCardVotes {
  conflict_id: string;
  authority: string;
  suggested_name: string;
  agree_voters: VoterProfile[];
}

export interface ReviewVoteData {
  accept_voters: VoterProfile[];
  reject_voters: VoterProfile[];
}

export interface SynonymVoteData {
  agree_voters: VoterProfile[];
  disagree_voters: VoterProfile[];
}

export interface ChecklistVotes {
  conflictsBySpecies: Map<string, ConflictCardVotes[]>;
  reviewsBySpecies: Map<string, ReviewVoteData>;
  synonymsBySpecies: Map<string, SynonymVoteData>;
}

export function useChecklistVotes(checklistId: string) {
  return useQuery<ChecklistVotes>({
    queryKey: ["checklist-votes", checklistId],
    queryFn: async () => {
      const res = await fetch(`/api/checklists/${checklistId}/votes`);
      if (!res.ok) throw new Error("Failed to fetch votes");

      type RawReviewVote = {
        species_id: string;
        reviewer_id: string;
        decision: string;
        reviewer_profile: { full_name: string | null; avatar_url: string | null } | null;
      };

      const data = (await res.json()) as {
        conflict_votes: Array<{
          species_id: string | null;
          conflict_id: string;
          authority: string | null;
          suggested_name: string | null;
          voter_id: string;
          voter_profile: { full_name: string | null; avatar_url: string | null } | null;
        }>;
        review_votes: RawReviewVote[];
        synonym_votes: RawReviewVote[];
      };

      const conflictsBySpecies = new Map<string, ConflictCardVotes[]>();
      const reviewsBySpecies = new Map<string, ReviewVoteData>();
      const synonymsBySpecies = new Map<string, SynonymVoteData>();

      for (const cv of data.conflict_votes ?? []) {
        if (!cv.species_id || !cv.authority || !cv.suggested_name) continue;
        const cards = conflictsBySpecies.get(cv.species_id) ?? [];
        let card = cards.find((c) => c.conflict_id === cv.conflict_id);
        if (!card) {
          card = {
            conflict_id: cv.conflict_id,
            authority: cv.authority,
            suggested_name: cv.suggested_name,
            agree_voters: [],
          };
          cards.push(card);
          conflictsBySpecies.set(cv.species_id, cards);
        }
        card.agree_voters.push({
          user_id: cv.voter_id,
          full_name: cv.voter_profile?.full_name ?? null,
          avatar_url: cv.voter_profile?.avatar_url ?? null,
        });
      }

      for (const rv of data.review_votes ?? []) {
        const entry = reviewsBySpecies.get(rv.species_id) ?? { accept_voters: [], reject_voters: [] };
        const voter: VoterProfile = {
          user_id: rv.reviewer_id,
          full_name: rv.reviewer_profile?.full_name ?? null,
          avatar_url: rv.reviewer_profile?.avatar_url ?? null,
        };
        if (rv.decision === "accept") entry.accept_voters.push(voter);
        else entry.reject_voters.push(voter);
        reviewsBySpecies.set(rv.species_id, entry);
      }

      for (const sv of data.synonym_votes ?? []) {
        const entry = synonymsBySpecies.get(sv.species_id) ?? { agree_voters: [], disagree_voters: [] };
        const voter: VoterProfile = {
          user_id: sv.reviewer_id,
          full_name: sv.reviewer_profile?.full_name ?? null,
          avatar_url: sv.reviewer_profile?.avatar_url ?? null,
        };
        if (sv.decision === "agree") entry.agree_voters.push(voter);
        else entry.disagree_voters.push(voter);
        synonymsBySpecies.set(sv.species_id, entry);
      }

      return { conflictsBySpecies, reviewsBySpecies, synonymsBySpecies };
    },
    staleTime: 15_000,
  });
}
