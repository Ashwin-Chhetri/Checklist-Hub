import type {
  ChecklistContributor,
  ChecklistMetadata,
  ChecklistMetadataResponse,
} from "@/types/checklist.types";

export async function getChecklistMetadata(checklistId: string): Promise<ChecklistMetadataResponse> {
  const response = await fetch(`/api/checklists/${checklistId}/metadata`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to load checklist metadata.");
  }
  return response.json();
}

export async function saveChecklistMetadata(
  checklistId: string,
  metadata: Partial<ChecklistMetadata>,
  contributors: ChecklistContributor[],
): Promise<void> {
  const response = await fetch(`/api/checklists/${checklistId}/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metadata, contributors }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to save checklist metadata.");
  }
}
