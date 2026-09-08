import { createClient } from "@/lib/supabase/client";
import { parseJsonResponse } from "@/lib/http/parseJsonResponse";
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

// Taxonomy resolution for a batch happens server-side before insert (see
// buildSpeciesPayload.server.ts) but is itself batched now, so a batch
// hanging well past this is a stuck connection, not real work — without a
// cap, a killed/reset connection just leaves the caller waiting forever.
const REQUEST_TIMEOUT_MS = 45_000;

export async function addSpeciesToChecklist(
  checklistId: string,
  species: CreateChecklistSpeciesInput[],
): Promise<AddSpeciesResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`/api/checklists/${checklistId}/species`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ species }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The server took too long to respond. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return parseJsonResponse<AddSpeciesResult>(res, "Failed to add species.");
}
