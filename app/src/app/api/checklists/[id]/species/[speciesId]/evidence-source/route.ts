import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type EvidenceSourceAction = "add" | "discard" | "restore";
type EvidenceSourceKey = "gbif" | "ebird" | "inaturalist" | "literature" | "legacy";

const ACTIONS: EvidenceSourceAction[] = ["add", "discard", "restore"];
const SOURCES: EvidenceSourceKey[] = ["gbif", "ebird", "inaturalist", "literature", "legacy"];

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

  let body: {
    action: EvidenceSourceAction;
    source: EvidenceSourceKey;
    reference_text?: string | null;
    source_link?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: "action must be 'add', 'discard', or 'restore'." }, { status: 400 });
  }
  if (!SOURCES.includes(body.source)) {
    return NextResponse.json({ error: "source must be a known evidence source." }, { status: 400 });
  }

  const { id: checklistId, speciesId } = await params;

  const { data: result, error: rpcError } = await supabase.rpc("set_evidence_source", {
    p_species_id: speciesId,
    p_checklist_id: checklistId,
    p_action: body.action,
    p_source: body.source,
    p_reference_text: body.reference_text ?? null,
    p_source_link: body.source_link ?? null,
  });

  if (rpcError) {
    const status = rpcError.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: rpcError.message }, { status });
  }

  return NextResponse.json(result ?? { ok: true });
}
