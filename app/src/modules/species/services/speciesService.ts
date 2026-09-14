import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { refreshSessionOnce } from "@/lib/supabase/refreshSession";
import { runInBatches } from "@/lib/async/runInBatches";
import { parseJsonResponse } from "@/lib/http/parseJsonResponse";
import type { CreateChecklistSpeciesInput } from "@/types/checklist.types";
import type { ReviewStatus, Species } from "@/types/species.types";

export async function listSpecies(checklistId: string): Promise<Species[]> {
  const supabase = createClient();
  return fetchAllRows<Species>((from, to) =>
    supabase
      .from("species")
      .select("*")
      .eq("checklist_id", checklistId)
      .order("scientific_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
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

// Bulk review actions (accept/reject a whole selection at once) update
// review_status for many rows in size-capped batches instead of one request
// per species — a naive per-row loop over hundreds/thousands of selected
// species fires that many concurrent direct-to-Supabase requests, which can
// both overwhelm the project's connection limit and race Supabase's
// refresh-token rotation the same way the checklist-creation import can (see
// refreshSessionOnce) when the session is stale at the start of the bulk
// action.
const REVIEW_STATUS_BATCH_SIZE = 150;
const REVIEW_STATUS_BATCH_CONCURRENCY = 4;

async function updateReviewStatusBatch(
  speciesIds: string[],
  reviewStatus: ReviewStatus,
  retriedAfterAuthRefresh = false,
): Promise<void> {
  const supabase = createClient();
  const { error, status } = await supabase
    .from("species")
    .update({ review_status: reviewStatus })
    .in("id", speciesIds);

  if (status === 401 && !retriedAfterAuthRefresh) {
    await refreshSessionOnce();
    return updateReviewStatusBatch(speciesIds, reviewStatus, true);
  }

  if (error) throw error;
}

export async function bulkUpdateReviewStatus(
  speciesIds: string[],
  reviewStatus: ReviewStatus,
): Promise<void> {
  await runInBatches(speciesIds, REVIEW_STATUS_BATCH_SIZE, REVIEW_STATUS_BATCH_CONCURRENCY, (batch) =>
    updateReviewStatusBatch(batch, reviewStatus),
  );
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
  retriedAfterAuthRefresh = false,
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

  // See refreshSessionOnce: a batch can lose a refresh-token rotation race
  // against its sibling batches and come back 401 even though the user is
  // still signed in. Refresh once (coalesced across siblings hitting this at
  // the same time) and retry this batch a single time before giving up.
  if (res.status === 401 && !retriedAfterAuthRefresh) {
    await refreshSessionOnce();
    return addSpeciesToChecklist(checklistId, species, true);
  }

  return parseJsonResponse<AddSpeciesResult>(res, "Failed to add species.");
}
