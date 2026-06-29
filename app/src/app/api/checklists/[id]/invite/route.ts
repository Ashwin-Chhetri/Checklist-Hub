import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/invites/sendInviteEmail.server";

/**
 * POST /api/checklists/[id]/invite
 *
 * Single entry point for the Share dialog's "Invite by Email": grants
 * immediate collaborator access if the email already belongs to a signed-up
 * user (via the invite_collaborator_to_checklist RPC), and emails the
 * invitee either way — "shared with you" if they already have an account,
 * "come create an account" if they don't. Every collaborator gets full
 * (editor-level) access — there's no role to choose.
 *
 * Body: { email: string; note?: string }
 */
export async function POST(
  request: NextRequest,
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

  let body: { email: string; note?: string };
  try {
    body = (await request.json()) as { email: string; note?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.email?.trim()) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  const { data: result, error: rpcError } = await supabase.rpc("invite_collaborator_to_checklist", {
    p_checklist_id: checklistId,
    p_email: body.email,
    p_note: body.note ?? null,
  });

  if (rpcError) {
    const status = rpcError.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: rpcError.message }, { status });
  }

  const [{ data: checklist }, { count: speciesCount }, { data: profile }] = await Promise.all([
    supabase
      .from("checklists")
      .select("id, title, region_name, taxonomic_scope")
      .eq("id", checklistId)
      .single(),
    supabase.from("species").select("id", { count: "exact", head: true }).eq("checklist_id", checklistId),
    supabase.from("profiles").select("full_name, email").eq("id", user.id).single(),
  ]);

  if (checklist) {
    await sendInviteEmail({
      origin: request.nextUrl.origin,
      inviterName: profile?.full_name || profile?.email || "A collaborator",
      checklist,
      speciesCount: speciesCount ?? 0,
      toEmail: result.email,
      hasAccount: result.matched,
      note: body.note,
    });
  }

  return NextResponse.json(result);
}
