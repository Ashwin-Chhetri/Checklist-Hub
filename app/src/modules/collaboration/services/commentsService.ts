import { createClient } from "@/lib/supabase/client";
import type { CommentAttachment, MentionedRef, RecentComment, SpeciesComment } from "@/types/collaboration.types";

export async function listComments(speciesId: string): Promise<SpeciesComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("species_comments")
    .select("*, author:profiles(id, full_name, avatar_url, email)")
    .eq("species_id", speciesId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as SpeciesComment[];
}

export async function postComment(input: {
  speciesId: string;
  authorId: string;
  body: string;
  parentCommentId?: string;
  mentions?: string[];
  mentionedSpecies?: string[];
  mentionedRefs?: MentionedRef[];
  attachments?: CommentAttachment[];
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("species_comments").insert({
    species_id: input.speciesId,
    author_id: input.authorId,
    body: input.body,
    parent_comment_id: input.parentCommentId ?? null,
    mentions: input.mentions ?? [],
    mentioned_species: input.mentionedSpecies ?? [],
    mentioned_refs: input.mentionedRefs ?? [],
    attachments: input.attachments ?? [],
  });

  if (error) throw error;
}

export async function updateComment(input: {
  commentId: string;
  body: string;
  mentions?: string[];
  mentionedSpecies?: string[];
  mentionedRefs?: MentionedRef[];
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("species_comments")
    .update({
      body: input.body,
      mentions: input.mentions ?? [],
      mentioned_species: input.mentionedSpecies ?? [],
      mentioned_refs: input.mentionedRefs ?? [],
      edited_at: new Date().toISOString(),
    })
    .eq("id", input.commentId);

  if (error) throw error;
}

export async function listRecentComments(checklistId: string, limit = 20): Promise<RecentComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("species_comments")
    .select(
      "*, author:profiles(id, full_name, avatar_url, email), species:species!inner(id, scientific_name, common_name, checklist_id)",
    )
    .eq("species.checklist_id", checklistId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as RecentComment[];
}
