import { createClient } from "@/lib/supabase/client";
import type { CreateChecklistSpeciesInput } from "@/types/checklist.types";
import type { ReviewStatus, Species } from "@/types/species.types";

export async function listSpecies(checklistId: string): Promise<Species[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("species")
    .select("*")
    .eq("checklist_id", checklistId)
    .order("scientific_name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Species[];
}

export async function getSpecies(speciesId: string): Promise<Species> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("species")
    .select("*, publications(*)")
    .eq("id", speciesId)
    .single();

  if (error) throw error;
  return data as Species;
}

export async function updateReviewStatus(
  speciesId: string,
  reviewStatus: ReviewStatus,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("species")
    .update({ review_status: reviewStatus })
    .eq("id", speciesId);

  if (error) throw error;
}

export interface AddSpeciesResult {
  added: number;
  skipped: number;
  species: Species[];
}

export async function addSpeciesToChecklist(
  checklistId: string,
  species: CreateChecklistSpeciesInput[],
): Promise<AddSpeciesResult> {
  const res = await fetch(`/api/checklists/${checklistId}/species`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ species }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to add species.");
  }
  return res.json();
}
