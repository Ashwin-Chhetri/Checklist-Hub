import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/checklists/[id]/species/[speciesId]/conflict-vote
 *
 * Toggles the current user's AGREE vote on a specific taxonomy authority conflict.
 * If all collaborators agree on the same conflict, it is auto-resolved and the
 * DB trigger updates the species taxonomy_status.
 *
 * Body: { authority: string; suggested_name: string }
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

  let authority: string, suggested_name: string;
  try {
    ({ authority, suggested_name } = (await request.json()) as {
      authority: string;
      suggested_name: string;
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!authority || !suggested_name) {
    return NextResponse.json({ error: "authority and suggested_name are required." }, { status: 400 });
  }

  const { data: result, error: rpcError } = await supabase.rpc("cast_conflict_vote", {
    p_species_id: speciesId,
    p_checklist_id: checklistId,
    p_authority: authority,
    p_suggested_name: suggested_name,
  });

  if (rpcError) {
    const status = rpcError.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: rpcError.message }, { status });
  }

  return NextResponse.json(result);
}
