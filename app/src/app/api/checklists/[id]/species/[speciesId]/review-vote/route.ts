import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/checklists/[id]/species/[speciesId]/review-vote
 *
 * Toggles the current user's accept/reject review vote on a species row.
 * If all collaborators agree on the same decision, review_status is updated.
 *
 * Body: { decision: "accept" | "reject" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; speciesId: string }> },
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId, speciesId } = await params;

  let decision: "accept" | "reject" | "agree" | "disagree";
  try {
    ({ decision } = (await request.json()) as { decision: "accept" | "reject" | "agree" | "disagree" });
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!["accept", "reject", "agree", "disagree"].includes(decision)) {
    return NextResponse.json({ error: "decision must be 'accept', 'reject', 'agree', or 'disagree'." }, { status: 400 });
  }

  const { data: result, error: rpcError } = await supabase.rpc("cast_review_vote", {
    p_species_id: speciesId,
    p_checklist_id: checklistId,
    p_decision: decision,
  });

  if (rpcError) {
    const status = rpcError.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: rpcError.message }, { status });
  }

  return NextResponse.json(result);
}
