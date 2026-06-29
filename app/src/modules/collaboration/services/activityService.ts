import { createClient } from "@/lib/supabase/client";
import type { ActivityLogEntry } from "@/types/collaboration.types";

export async function listActivity(
  checklistId: string,
  options: { actions?: string[]; limit?: number } = {},
): Promise<ActivityLogEntry[]> {
  const supabase = createClient();
  let query = supabase
    .from("activity_log")
    .select("*, actor:profiles(id, full_name, avatar_url, email)")
    .eq("checklist_id", checklistId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 30);

  if (options.actions?.length) {
    query = query.in("action", options.actions);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ActivityLogEntry[];
}
