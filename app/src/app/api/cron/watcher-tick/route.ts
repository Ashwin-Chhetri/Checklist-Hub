import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { runWatcherEtl } from "@/modules/watching/runWatcherEtl.server";

/**
 * GET /api/cron/watcher-tick — invoked daily by Vercel Cron (see
 * vercel.json). Finds every active watcher whose `next_run_at` has passed
 * and runs its ETL tick, isolating failures so one bad checklist can't sink
 * the rest (each tick advances its own `next_run_at`, so a daily cron
 * granularity is fine for weekly/monthly schedules).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: dueWatchers, error } = await supabase
    .from("watchers")
    .select("id")
    .eq("is_active", true)
    .lte("next_run_at", new Date().toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const results = await Promise.allSettled(
    (dueWatchers ?? []).map((w) => runWatcherEtl(w.id, origin)),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  return NextResponse.json({ processed: results.length, failed });
}
