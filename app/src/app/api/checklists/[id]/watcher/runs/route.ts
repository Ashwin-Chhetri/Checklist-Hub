import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** GET /api/checklists/[id]/watcher/runs — recent run history for the sidebar list. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId } = await params;
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? "20"), 100);

  const { data: runs, error } = await supabase
    .from("watcher_runs")
    .select("*")
    .eq("checklist_id", checklistId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ runs: runs ?? [] });
}
