import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  ChecklistContributor,
  ChecklistMetadata,
  ChecklistMetadataResponse,
} from "@/types/checklist.types";

/**
 * GET /api/checklists/[id]/metadata
 *
 * Returns the checklist's Darwin Core/EML-shaped publication metadata plus
 * its ordered contributor list. Both are read-only here (RLS already scopes
 * to members) — writes go through the `upsert_checklist_metadata` RPC below
 * so the metadata row and contributor list stay consistent in one
 * transaction.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  const [{ data: metadata }, { data: contributors }] = await Promise.all([
    supabase.from("checklist_metadata").select("*").eq("checklist_id", checklistId).maybeSingle(),
    supabase
      .from("checklist_contributors")
      .select("id, name, role, institution, orcid, email")
      .eq("checklist_id", checklistId)
      .order("position", { ascending: true }),
  ]);

  const response: ChecklistMetadataResponse = {
    metadata: (metadata as ChecklistMetadata | null) ?? null,
    contributors: (contributors as ChecklistContributor[]) ?? [],
  };

  return NextResponse.json(response);
}

/**
 * PUT /api/checklists/[id]/metadata
 *
 * Body: { metadata: Partial<ChecklistMetadata>, contributors: ChecklistContributor[] }
 *
 * Single RPC call (upsert_checklist_metadata) does the metadata upsert and
 * contributor-list replace in one transaction, instead of chaining several
 * Postgrest calls from the route.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  let body: { metadata: Partial<ChecklistMetadata>; contributors: ChecklistContributor[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { error: rpcError } = await supabase.rpc("upsert_checklist_metadata", {
    p_checklist_id: checklistId,
    p_metadata: body.metadata ?? {},
    p_contributors: body.contributors ?? [],
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
