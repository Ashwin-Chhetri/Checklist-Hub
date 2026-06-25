import { createClient } from "@/lib/supabase/client";
import type { Species } from "@/types/species.types";
import type { ChecklistPublicationSnapshot } from "@/types/checklist.types";
import type { ValidationReport } from "@/app/api/checklists/[id]/validate/route";

export type { ValidationReport };

/**
 * Publication readiness is computed server-side by the same validation
 * report used elsewhere in the workbench (`GET /api/checklists/[id]/validate`)
 * so there's a single source of truth for "is this checklist ready to
 * publish" — see `ValidationReport.is_ready`.
 */
export async function getPublicationReadiness(checklistId: string): Promise<ValidationReport> {
  const response = await fetch(`/api/checklists/${checklistId}/validate`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to load validation report.");
  }
  return response.json();
}

export async function getAcceptedSpecies(checklistId: string): Promise<Species[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("species")
    .select("*")
    .eq("checklist_id", checklistId)
    .eq("review_status", "accepted")
    .eq("is_active", true)
    .order("scientific_name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Species[];
}

export async function publishChecklist(checklistId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("record_checklist_publication", {
    p_checklist_id: checklistId,
  });

  if (error) throw error;
}

/** Marks the IPT-side submission (resource created/published/registered on the user's IPT) as done, while still awaiting GBIF to assign a dataset UUID — moves the checklist to "reviewing" status. */
export async function markChecklistSubmittedForReview(checklistId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_checklist_submitted_for_review", {
    p_checklist_id: checklistId,
  });

  if (error) throw error;
}

/** Most recent publish snapshot for this checklist, or null if it has never been published. */
export async function getPublicationHistory(
  checklistId: string,
): Promise<ChecklistPublicationSnapshot | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklist_publication_snapshots")
    .select("*")
    .eq("checklist_id", checklistId)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as ChecklistPublicationSnapshot | null) ?? null;
}
