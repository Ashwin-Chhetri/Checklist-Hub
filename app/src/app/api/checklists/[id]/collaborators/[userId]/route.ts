import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * DELETE /api/checklists/[id]/collaborators/[userId]
 *
 * Lets the checklist owner remove a collaborator from the Share dialog, via
 * the remove_collaborator_from_checklist RPC. There's no role to manage
 * anymore — every collaborator has full access, so the only membership
 * action left is adding (invite) or removing someone.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId, userId } = await params;

  const { data: result, error: rpcError } = await supabase.rpc("remove_collaborator_from_checklist", {
    p_checklist_id: checklistId,
    p_user_id: userId,
  });

  if (rpcError) {
    const status = rpcError.code === "42501" ? 403 : rpcError.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: rpcError.message }, { status });
  }

  return NextResponse.json(result);
}
