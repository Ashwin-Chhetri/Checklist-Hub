import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function addInterval(date: Date, frequency: "weekly" | "monthly"): Date {
  const next = new Date(date);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/** GET /api/checklists/[id]/watcher — current config + subscriber list, or { watcher: null }. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  const { data: watcher, error } = await supabase
    .from("watchers")
    .select("*")
    .eq("checklist_id", checklistId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!watcher) return NextResponse.json({ watcher: null, subscribers: [] });

  const { data: subscribers } = await supabase
    .from("watcher_subscribers")
    .select("user_id")
    .eq("watcher_id", watcher.id);

  return NextResponse.json({ watcher, subscribers: (subscribers ?? []).map((s) => s.user_id) });
}

interface PutBody {
  frequency: "weekly" | "monthly";
  subscriber_user_ids: string[];
}

/** PUT /api/checklists/[id]/watcher — create or update the watcher + its subscriber list. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.frequency !== "weekly" && body.frequency !== "monthly") {
    return NextResponse.json({ error: "frequency must be 'weekly' or 'monthly'." }, { status: 400 });
  }

  const { data: checklist, error: checklistError } = await supabase
    .from("checklists")
    .select("id, created_at")
    .eq("id", checklistId)
    .single();
  if (checklistError || !checklist) {
    return NextResponse.json({ error: "Checklist not found." }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("watchers")
    .select("id, started_at")
    .eq("checklist_id", checklistId)
    .maybeSingle();

  const startedAt = existing?.started_at ?? checklist.created_at;
  const nextRunAt = addInterval(new Date(startedAt), body.frequency);

  const { data: watcher, error: upsertError } = await supabase
    .from("watchers")
    .upsert(
      {
        id: existing?.id,
        checklist_id: checklistId,
        frequency: body.frequency,
        is_active: true,
        started_at: startedAt,
        next_run_at: nextRunAt.toISOString(),
        created_by: existing ? undefined : user.id,
      },
      { onConflict: "checklist_id" },
    )
    .select("*")
    .single();

  if (upsertError || !watcher) {
    const status = upsertError?.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: upsertError?.message ?? "Failed to save watcher." }, { status });
  }

  await supabase.from("watcher_subscribers").delete().eq("watcher_id", watcher.id);
  const subscriberIds = [...new Set(body.subscriber_user_ids ?? [])];
  if (subscriberIds.length > 0) {
    const { error: subscribersError } = await supabase
      .from("watcher_subscribers")
      .insert(subscriberIds.map((userId) => ({ watcher_id: watcher.id, user_id: userId })));
    if (subscribersError) {
      return NextResponse.json({ error: subscribersError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ watcher, subscribers: subscriberIds });
}

/** DELETE /api/checklists/[id]/watcher — deactivate (soft) the watcher. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: checklistId } = await params;

  const { error } = await supabase
    .from("watchers")
    .update({ is_active: false })
    .eq("checklist_id", checklistId);

  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}
