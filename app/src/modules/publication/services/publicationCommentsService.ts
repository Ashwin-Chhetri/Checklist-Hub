import { createClient } from "@/lib/supabase/client";
import type { ChecklistPublicationComment, PublicationCommentDecision } from "@/types/checklist.types";

export async function listPublicationComments(checklistId: string): Promise<ChecklistPublicationComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklist_publication_comments")
    .select("*, author:profiles(id, full_name, avatar_url, email)")
    .eq("checklist_id", checklistId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ChecklistPublicationComment[];
}

export async function postPublicationComment(input: {
  checklistId: string;
  authorId: string;
  body: string;
  decision?: PublicationCommentDecision | null;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("checklist_publication_comments").insert({
    checklist_id: input.checklistId,
    author_id: input.authorId,
    body: input.body,
    decision: input.decision ?? null,
  });

  if (error) throw error;
}
