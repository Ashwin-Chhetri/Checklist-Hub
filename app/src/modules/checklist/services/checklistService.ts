import { createClient } from "@/lib/supabase/client";
import { parseJsonResponse } from "@/lib/http/parseJsonResponse";
import { addSpeciesToChecklist } from "@/modules/species/services/speciesService";
import type { Checklist, ChecklistPublicationDraft, CreateChecklistInput } from "@/types/checklist.types";
import type { ChecklistInvite, Collaborator, Profile } from "@/types/collaboration.types";
import type { WatchFrequency } from "@/types/watching.types";

// Keep the initial POST body (and each follow-up append) small enough to
// stay well under typical platform request-body limits (e.g. Vercel's
// ~4.5MB) — a checklist with tens of thousands of species, each carrying
// classification/occurrence/source-link/revision data, can otherwise
// balloon a single JSON payload past that limit and come back as a
// plain-text 413 instead of the created checklist.
const SPECIES_BATCH_SIZE = 300;
// Bound how many batches run concurrently so large (50k+ species) checklists
// don't take one request each in strict sequence, without opening so many
// connections at once that we trip a different rate limit.
const BATCH_CONCURRENCY = 4;

// Each batch does taxonomy resolution server-side before inserting, but that
// work is now batched too (see buildSpeciesPayload.server.ts) — a batch
// hanging well past this is a stuck connection, not real work in progress.
// Without a client-side cap, a killed/reset connection just leaves the user
// staring at "Creating..." indefinitely instead of surfacing an error.
const REQUEST_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The server took too long to respond. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Thrown when the checklist itself was created but appending some of its
 * species afterward failed partway through — the checklist is NOT lost (it
 * already exists with `completedAtLeast` species), so callers should offer a
 * retry that resumes rather than telling the user the whole operation failed.
 */
export class PartialChecklistCreationError extends Error {
  constructor(
    message: string,
    public readonly checklistId: string,
    public readonly completedAtLeast: number,
    public readonly total: number,
  ) {
    super(message);
    this.name = "PartialChecklistCreationError";
  }
}

async function runInBatches<T>(items: T[], batchSize: number, concurrency: number, run: (batch: T[]) => Promise<void>) {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < batches.length) {
      const batch = batches[nextIndex++];
      await run(batch);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
}

export interface ChecklistCollaboratorProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface ChecklistPendingInvite {
  email: string;
  status: string;
}

export interface ChecklistSummary extends Checklist {
  species_count: number;
  collaborator_count: number;
  owner: ChecklistCollaboratorProfile | null;
  collaborators: ChecklistCollaboratorProfile[];
  pendingInvites: ChecklistPendingInvite[];
  publication_draft: ChecklistPublicationDraft | null;
  has_metadata: boolean;
  /** Set once the user marks the IPT-side submission done — see mark_checklist_submitted_for_review. Null until then, even though status flips to 'reviewing' at the same time. */
  ipt_submitted_at: string | null;
  /** Null when no watcher has ever been configured for this checklist. */
  watcher: { is_active: boolean; frequency: WatchFrequency } | null;
}

export async function listChecklists(): Promise<ChecklistSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklists")
    .select(
      "*, owner:profiles!checklists_owner_id_fkey(id, full_name, avatar_url), species(count), checklist_collaborators(profile:profiles!checklist_collaborators_user_id_fkey(id, full_name, avatar_url)), checklist_invites(email, status), checklist_publication_drafts(checklist_id, stage, package_storage_path, package_generated_at, updated_at), checklist_metadata(checklist_id, ipt_submitted_at), watchers(is_active, frequency)",
    )
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const {
      species,
      checklist_collaborators,
      checklist_invites,
      checklist_publication_drafts,
      checklist_metadata,
      watchers,
      owner,
      ...checklist
    } = row as Checklist & {
      species: { count: number }[];
      checklist_collaborators: { profile: ChecklistCollaboratorProfile | null }[];
      checklist_invites: ChecklistPendingInvite[];
      // checklist_id is the PRIMARY KEY on both these tables (1:1 with
      // checklists), so PostgREST embeds them as a single nullable object,
      // not an array — unlike checklist_collaborators/species/invites above,
      // whose checklist_id is just a plain (non-unique) foreign key.
      checklist_publication_drafts: ChecklistPublicationDraft | null;
      checklist_metadata: { checklist_id: string; ipt_submitted_at: string | null } | null;
      // watchers.checklist_id carries a `unique` constraint, so this also embeds as a single nullable object.
      watchers: { is_active: boolean; frequency: WatchFrequency } | null;
      owner: ChecklistCollaboratorProfile | null;
    };
    const collaborators = (checklist_collaborators ?? [])
      .map((c) => c.profile)
      .filter((p): p is ChecklistCollaboratorProfile => p !== null);
    return {
      ...checklist,
      species_count: species?.[0]?.count ?? 0,
      collaborator_count: collaborators.length + 1,
      owner,
      collaborators,
      pendingInvites: (checklist_invites ?? []).filter((i) => i.status === "pending"),
      publication_draft: checklist_publication_drafts ?? null,
      has_metadata: checklist_metadata != null,
      ipt_submitted_at: checklist_metadata?.ipt_submitted_at ?? null,
      watcher: watchers ?? null,
    };
  });
}

export async function getChecklist(checklistId: string): Promise<Checklist> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklists")
    .select("*")
    .eq("id", checklistId)
    .single();

  if (error) throw error;
  return data as Checklist;
}

export interface CreateChecklistProgress {
  /** Species inserted into the checklist so far, across the initial POST and every append batch. */
  completed: number;
  /** Total species this call was asked to create — same for every progress callback within one call. */
  total: number;
  /** The checklist's id, known from the very first progress callback onward (once the initial POST has
   *  returned) — lets callers persist "checklist X exists, resume its import" before the whole call finishes,
   *  so a page refresh/lost connection partway through doesn't strand an unfinished checklist with no way back. */
  checklistId: string;
}

export async function createChecklist(
  input: CreateChecklistInput,
  onProgress?: (progress: CreateChecklistProgress) => void,
): Promise<Checklist> {
  const allSpecies = input.species ?? [];
  const firstBatch = allSpecies.slice(0, SPECIES_BATCH_SIZE);
  const remaining = allSpecies.slice(SPECIES_BATCH_SIZE);
  const total = allSpecies.length;

  const response = await fetchWithTimeout("/api/checklists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, species: firstBatch, totalSpeciesCount: total }),
  });

  const body = await parseJsonResponse<{ checklist: Checklist }>(response, "Failed to create checklist.");
  const checklist = body.checklist;
  onProgress?.({ completed: firstBatch.length, total, checklistId: checklist.id });

  // The checklist now exists with its first batch of species — append the
  // rest in further size-capped requests instead of one all-or-nothing POST,
  // reporting progress after each batch so the UI can show real feedback
  // instead of a bare spinner for what can be a multi-minute operation on
  // very large (10k+) species lists.
  //
  // If an append batch fails partway (timeout, dropped connection, server
  // error), the checklist itself is NOT lost — it already exists with
  // whatever species made it in. Surface that as a PartialChecklistCreationError
  // instead of a plain failure, so the caller can offer "retry remaining"
  // (see resumeChecklistSpeciesImport) instead of implying total failure.
  if (remaining.length > 0) {
    let completed = firstBatch.length;
    try {
      await runInBatches(remaining, SPECIES_BATCH_SIZE, BATCH_CONCURRENCY, async (batch) => {
        await addSpeciesToChecklist(checklist.id, batch);
        completed += batch.length;
        onProgress?.({ completed, total, checklistId: checklist.id });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add all species to the checklist.";
      throw new PartialChecklistCreationError(message, checklist.id, completed, total);
    }
  }

  return checklist;
}

/**
 * Resumes an interrupted import by re-sending the FULL original species list
 * against an already-created checklist — the append endpoint dedupes against
 * species already present (by scientific name / GBIF key), so already-added
 * rows are skipped server-side rather than needing the caller to know exactly
 * which ones made it in (batches run concurrently, so a failure doesn't imply
 * a clean prefix was completed).
 */
export async function resumeChecklistSpeciesImport(
  checklistId: string,
  allSpecies: CreateChecklistInput["species"],
  onProgress?: (progress: CreateChecklistProgress) => void,
): Promise<void> {
  const species = allSpecies ?? [];
  const total = species.length;
  let scanned = 0;
  await runInBatches(species, SPECIES_BATCH_SIZE, BATCH_CONCURRENCY, async (batch) => {
    await addSpeciesToChecklist(checklistId, batch);
    scanned += batch.length;
    onProgress?.({ completed: scanned, total, checklistId });
  });
}

export async function getChecklistCollaborators(checklistId: string): Promise<Collaborator[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklist_collaborators")
    .select("*, profile:profiles!checklist_collaborators_user_id_fkey(*)")
    .eq("checklist_id", checklistId);

  if (error) throw error;
  return (data ?? []) as unknown as Collaborator[];
}

export async function updateChecklist(
  checklistId: string,
  updates: Partial<
    Pick<
      Checklist,
      | "title"
      | "region_name"
      | "region_district"
      | "region_state"
      | "region_country"
      | "region_gadm_id"
      | "region_osm_type"
      | "region_osm_id"
      | "region_pin"
      | "taxonomic_scope"
    >
  >,
): Promise<Checklist> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklists")
    .update(updates)
    .eq("id", checklistId)
    .select()
    .single();

  if (error) throw error;
  return data as Checklist;
}

export async function deleteChecklist(checklistId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("checklists").delete().eq("id", checklistId);
  if (error) throw error;
}

export async function listChecklistInvites(checklistId: string): Promise<ChecklistInvite[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("checklist_invites")
    .select("*")
    .eq("checklist_id", checklistId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as ChecklistInvite[];
}

export async function inviteCollaborator(
  checklistId: string,
  input: { email: string; note?: string },
): Promise<{ ok: boolean; matched: boolean; email: string }> {
  const response = await fetch(`/api/checklists/${checklistId}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseJsonResponse<{ ok: boolean; matched: boolean; email: string }>(
    response,
    "Failed to invite collaborator.",
  );
}

export async function removeCollaborator(checklistId: string, userId: string): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/checklists/${checklistId}/collaborators/${userId}`, {
    method: "DELETE",
  });

  return parseJsonResponse<{ ok: boolean }>(response, "Failed to remove collaborator.");
}

export type EmailLookupResult = { matched: true; profile: Profile } | { matched: false; verified: boolean };

/**
 * Authoritative exact-match pool check + MX fallback for the typed email in
 * an invite field — see `/api/users/email-lookup` for the actual logic.
 */
export async function lookupEmail(email: string): Promise<EmailLookupResult> {
  const response = await fetch(`/api/users/email-lookup?email=${encodeURIComponent(email)}`);
  return parseJsonResponse<EmailLookupResult>(response, "Failed to look up email.");
}

export async function searchProfiles(query: string, excludeIds: string[] = []): Promise<Profile[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`)
    .limit(8);

  if (error) throw error;
  return ((data ?? []) as Profile[]).filter((p) => !excludeIds.includes(p.id));
}
