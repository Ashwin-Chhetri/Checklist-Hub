import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface MergeBody {
  /** The species row this synonym should be merged into (the accepted-name row). */
  target_species_id: string;
}

/**
 * POST /api/checklists/[id]/species/[speciesId]/merge
 *
 * Marks a synonym species row as inactive and records which accepted-name row
 * it was merged into. The row is NEVER deleted — evidence, comments, review
 * history, and the original source name are all preserved for audit and undo.
 *
 * Body: { target_species_id: string }
 *
 * After this call:
 *   species.is_active              = false
 *   species.merged_into_species_id = target_species_id
 *
 * The workbench default views filter WHERE is_active = true, so the merged row
 * disappears from normal views but remains visible in the "Merged / Hidden" view.
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
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { id: checklistId, speciesId } = await params;

  let body: MergeBody;
  try {
    body = (await request.json()) as MergeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.target_species_id) {
    return NextResponse.json({ error: "target_species_id is required." }, { status: 400 });
  }

  const { data: result, error: rpcError } = await supabase.rpc("merge_species", {
    p_species_id: speciesId,
    p_checklist_id: checklistId,
    p_target_species_id: body.target_species_id,
  });

  if (rpcError) {
    const status = rpcError.code === "P0002" ? 404 : rpcError.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: rpcError.message }, { status });
  }

  return NextResponse.json(result);
}

/**
 * DELETE /api/checklists/[id]/species/[speciesId]/merge
 *
 * Undoes a merge: restores is_active = true and clears merged_into_species_id.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; speciesId: string }> },
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { id: checklistId, speciesId } = await params;

  // Verify the row belongs to this checklist.
  const { data: row } = await supabase
    .from("species")
    .select("id, checklist_id, is_active, merged_into_species_id")
    .eq("id", speciesId)
    .eq("checklist_id", checklistId)
    .single();

  if (!row) {
    return NextResponse.json({ error: "Species not found." }, { status: 404 });
  }

  if (row.is_active !== false) {
    return NextResponse.json({ error: "Species row is already active; nothing to undo." }, { status: 409 });
  }

  const { error: updateErr } = await supabase
    .from("species")
    .update({ is_active: true, merged_into_species_id: null })
    .eq("id", speciesId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, restored: speciesId });
}
