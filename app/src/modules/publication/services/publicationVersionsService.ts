import { createClient } from "@/lib/supabase/client";
import type { ChecklistContributor, ChecklistMetadata, ChecklistPublicationVersion } from "@/types/checklist.types";

export async function listPublicationVersions(checklistId: string): Promise<ChecklistPublicationVersion[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklist_publication_versions")
    .select("*")
    .eq("checklist_id", checklistId)
    .order("version_number", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as ChecklistPublicationVersion[];
}

export interface CreatePublicationVersionInput {
  checklistId: string;
  metadataSnapshot: ChecklistMetadata;
  contributorsSnapshot: ChecklistContributor[];
  files: { name: string; contents: string }[];
  packageStoragePath: string | null;
  changeSummary: string;
  editedFile: string;
}

/** Snapshots the current package/metadata state as a new version and logs it as an "edit" entry in Review Activity — see `create_publication_version` (migration 0044). */
export async function createPublicationVersion(input: CreatePublicationVersionInput): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_publication_version", {
    p_checklist_id: input.checklistId,
    p_metadata_snapshot: input.metadataSnapshot,
    p_contributors_snapshot: input.contributorsSnapshot,
    p_files: input.files,
    p_package_storage_path: input.packageStoragePath,
    p_change_summary: input.changeSummary,
    p_edited_file: input.editedFile,
  });

  if (error) throw error;
  return data as number;
}
