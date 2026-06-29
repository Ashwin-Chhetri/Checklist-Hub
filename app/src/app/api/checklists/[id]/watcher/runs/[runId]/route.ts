import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/checklists/[id]/watcher/runs/[runId] — one run's full detail:
 * pending candidate species + unapplied observation updates (joined with
 * species names), feeding the WatcherResultsDialog.
 */
export async function GET(
  _request: NextRequest,
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

  const { id: checklistId, runId } = await params;

  const [{ data: run, error: runError }, { data: candidates }, { data: updates }] = await Promise.all([
    supabase.from("watcher_runs").select("*").eq("id", runId).eq("checklist_id", checklistId).single(),
    supabase
      .from("watcher_candidate_species")
      .select("*")
      .eq("watcher_run_id", runId)
      .eq("status", "pending")
      .order("total_occurrences", { ascending: false }),
    supabase
      .from("watcher_observation_updates")
      .select("*, species:species_id(id, scientific_name, common_name)")
      .eq("watcher_run_id", runId)
      .eq("applied", false),
  ]);

  if (runError || !run) {
    return NextResponse.json({ error: runError?.message ?? "Run not found." }, { status: 404 });
  }

  return NextResponse.json({
    run,
    candidates: candidates ?? [],
    observationUpdates: updates ?? [],
  });
}
