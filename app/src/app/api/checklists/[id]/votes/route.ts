import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  // Verify caller has access
  const { data: checklist } = await supabase
    .from("checklists")
    .select("id, owner_id")
    .eq("id", checklistId)
    .single();

  if (!checklist) {
    return NextResponse.json({ error: "Checklist not found." }, { status: 404 });
  }

  // Get all taxonomy_conflicts scoped to this checklist via a single join on
  // species.checklist_id, instead of fetching every species id up front and
  // building a (potentially huge) IN(...) list — scales with checklist size.
  const { data: conflicts } = await supabase
    .from("taxonomy_conflicts")
    .select("id, species_id, authority, suggested_name, species!inner(checklist_id)")
    .eq("species.checklist_id", checklistId);

  const conflictIds = conflicts?.map((c) => c.id) ?? [];
  const conflictMap = new Map((conflicts ?? []).map((c) => [c.id, c]));

  // Get all AGREE votes for those conflicts (with voter profile)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawConflictVotes: any[] = [];

  if (conflictIds.length > 0) {
    const { data } = await supabase
      .from("taxonomy_votes")
      .select("conflict_id, voter_id, decision, profiles(full_name, avatar_url)")
      .in("conflict_id", conflictIds)
      .eq("decision", "agree");
    rawConflictVotes = data ?? [];
  }

  const conflict_votes = rawConflictVotes.map((v) => {
    const c = conflictMap.get(v.conflict_id as string);
    const profiles = v.profiles;
    const voter_profile = Array.isArray(profiles) ? (profiles[0] ?? null) : (profiles ?? null);
    return {
      species_id: c?.species_id ?? null,
      conflict_id: v.conflict_id as string,
      authority: c?.authority ?? null,
      suggested_name: c?.suggested_name ?? null,
      voter_id: v.voter_id as string,
      voter_profile: voter_profile as { full_name: string | null; avatar_url: string | null } | null,
    };
  });

  // Get all species_reviews for this checklist (all decision types), scoped via
  // the same join-on-checklist_id approach as the conflicts query above.
  const { data: rawReviewVotes } = await supabase
    .from("species_reviews")
    .select("species_id, reviewer_id, decision, profiles!reviewer_id(full_name, avatar_url), species!inner(checklist_id)")
    .eq("species.checklist_id", checklistId);

  const mapVotes = (decisions: string[]) =>
    (rawReviewVotes ?? [])
      .filter((v) => decisions.includes(v.decision))
      .map((v) => ({
        species_id: v.species_id,
        reviewer_id: v.reviewer_id,
        decision: v.decision,
        reviewer_profile: (v as Record<string, unknown>).profiles as {
          full_name: string | null;
          avatar_url: string | null;
        } | null,
      }));

  return NextResponse.json({
    conflict_votes,
    review_votes: mapVotes(["accept", "reject"]),
    synonym_votes: mapVotes(["agree", "disagree"]),
  });
}
