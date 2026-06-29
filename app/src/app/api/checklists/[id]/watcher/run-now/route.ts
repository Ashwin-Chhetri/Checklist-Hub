import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runWatcherEtl } from "@/modules/watching/runWatcherEtl.server";

/**
 * POST /api/checklists/[id]/watcher/run-now — the Watcher dialog's "Update
 * Observations" button: runs this checklist's watcher ETL immediately
 * (outside its normal weekly/monthly schedule) and returns the new run id
 * so the UI can open that run's results dialog directly.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  // Relies on the watchers_update_editor RLS policy (editor role required)
  // to authorize this — bumping updated_at also doubles as "does a watcher
  // exist for this checklist" in one round trip.
  const { data: watcher, error: watcherError } = await supabase
    .from("watchers")
    .update({ updated_at: new Date().toISOString() })
    .eq("checklist_id", checklistId)
    .select("id")
    .maybeSingle();

  if (watcherError) {
    const status = watcherError.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: watcherError.message }, { status });
  }
  if (!watcher) {
    return NextResponse.json({ error: "No watcher is set up for this checklist." }, { status: 404 });
  }

  try {
    const runId = await runWatcherEtl(watcher.id, request.nextUrl.origin, true);
    return NextResponse.json({ runId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
