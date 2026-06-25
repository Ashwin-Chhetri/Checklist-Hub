import { createClient } from "@/lib/supabase/client";
import type { ChecklistPublicationDraft, PublicationDraftStage } from "@/types/checklist.types";

export const PUBLICATION_EXPORTS_BUCKET = "publication-exports";

export async function getPublicationDraft(checklistId: string): Promise<ChecklistPublicationDraft | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklist_publication_drafts")
    .select("*")
    .eq("checklist_id", checklistId)
    .maybeSingle();

  if (error) throw error;
  return (data as ChecklistPublicationDraft | null) ?? null;
}

export async function savePublicationDraftStage(
  checklistId: string,
  stage: PublicationDraftStage,
  packageStoragePath?: string | null,
  packageGeneratedAt?: string | null,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("upsert_checklist_publication_draft", {
    p_checklist_id: checklistId,
    p_stage: stage,
    p_package_storage_path: packageStoragePath ?? null,
    p_package_generated_at: packageGeneratedAt ?? null,
  });
  if (error) throw error;
}

export async function deletePublicationDraft(checklistId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_checklist_publication_draft", {
    p_checklist_id: checklistId,
  });
  if (error) throw error;
}

/** Deletes the saved metadata/contributors for a checklist and clears its in-progress draft pointer — used by the "delete metadata" action in the checklist organizer's nested row. */
export async function deleteChecklistMetadata(checklistId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_checklist_metadata", {
    p_checklist_id: checklistId,
  });
  if (error) throw error;
}

/** Removes the generated DwC-A package from storage (best-effort — a missing object is not an error) and clears the draft's package pointer, reverting it to the metadata stage. */
export async function clearPublicationPackage(checklistId: string, storagePath: string | null): Promise<void> {
  const supabase = createClient();
  if (storagePath) {
    await supabase.storage.from(PUBLICATION_EXPORTS_BUCKET).remove([storagePath]);
  }
  const { error } = await supabase.rpc("clear_checklist_publication_package", {
    p_checklist_id: checklistId,
  });
  if (error) throw error;
}

/** Downloads the generated DwC-A package zip directly from storage (private bucket, so this goes through the authenticated client rather than a public URL). */
export async function downloadPublicationPackageBlob(storagePath: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(PUBLICATION_EXPORTS_BUCKET).download(storagePath);
  if (error) throw error;
  return data;
}
