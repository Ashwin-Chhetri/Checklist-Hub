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

/** Removes every storage object an RPC's `{ storage_paths: [...] }` result points at (best-effort — a missing object is not an error). Shared by every delete RPC below since a Postgres delete never touches Storage on its own. */
async function purgeReturnedStoragePaths(data: unknown): Promise<void> {
  const storagePaths = ((data as { storage_paths?: string[] } | null)?.storage_paths ?? []).filter(Boolean);
  if (storagePaths.length === 0) return;
  const supabase = createClient();
  await supabase.storage.from(PUBLICATION_EXPORTS_BUCKET).remove(storagePaths);
}

/**
 * Deletes the saved metadata/contributors for a checklist, clears its
 * in-progress draft pointer, and deletes its entire publication version
 * history — both the `checklist_publication_versions` rows and every
 * snapshot zip they (and the draft) point at in storage — so nothing is
 * left orphaned. Used by the "delete metadata" action in the checklist
 * organizer's nested row.
 */
export async function deleteChecklistMetadata(checklistId: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("delete_checklist_metadata", {
    p_checklist_id: checklistId,
  });
  if (error) throw error;
  await purgeReturnedStoragePaths(data);
}

/**
 * Deletes the generated DwC-A package and its entire version history for a
 * checklist: the draft's live package pointer, every
 * `checklist_publication_versions` row, and every object those rows (and
 * the draft) point at in storage.
 */
export async function clearPublicationPackage(checklistId: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clear_checklist_publication_package", {
    p_checklist_id: checklistId,
  });
  if (error) throw error;
  await purgeReturnedStoragePaths(data);
}

/** Downloads the generated DwC-A package zip directly from storage (private bucket, so this goes through the authenticated client rather than a public URL). */
export async function downloadPublicationPackageBlob(storagePath: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(PUBLICATION_EXPORTS_BUCKET).download(storagePath);
  if (error) throw error;
  return data;
}
