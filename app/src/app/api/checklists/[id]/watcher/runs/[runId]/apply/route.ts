import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ApplyBody {
  accepted_candidate_ids: string[];
}

/**
 * POST /api/checklists/[id]/watcher/runs/[runId]/apply — the results dialog's
 * "Updated" CTA: adds the checked candidates to the checklist's species table
 * (the rest are dismissed) and applies this run's observation-count updates,
 * via the `apply_watcher_run` RPC (security invoker — RLS enforces editor role).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { runId } = await params;

  let body: ApplyBody;
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { error } = await supabase.rpc("apply_watcher_run", {
    p_run_id: runId,
    p_accepted_candidate_ids: body.accepted_candidate_ids ?? [],
  });

  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}
