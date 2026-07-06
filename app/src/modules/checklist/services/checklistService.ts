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
}

export async function createChecklist(
  input: CreateChecklistInput,
  onProgress?: (progress: CreateChecklistProgress) => void,
): Promise<Checklist> {
  const allSpecies = input.species ?? [];
  const firstBatch = allSpecies.slice(0, SPECIES_BATCH_SIZE);
  const remaining = allSpecies.slice(SPECIES_BATCH_SIZE);
  const total = allSpecies.length;

  const response = await fetch("/api/checklists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, species: firstBatch, totalSpeciesCount: total }),
  });

  const body = await parseJsonResponse<{ checklist: Checklist }>(response, "Failed to create checklist.");
  const checklist = body.checklist;
  onProgress?.({ completed: firstBatch.length, total });

  // The checklist now exists with its first batch of species — append the
  // rest in further size-capped requests instead of one all-or-nothing POST,
  // reporting progress after each batch so the UI can show real feedback
  // instead of a bare spinner for what can be a multi-minute operation on
  // very large (10k+) species lists.
  if (remaining.length > 0) {
    let completed = firstBatch.length;
    await runInBatches(remaining, SPECIES_BATCH_SIZE, BATCH_CONCURRENCY, async (batch) => {
      await addSpeciesToChecklist(checklist.id, batch);
      completed += batch.length;
      onProgress?.({ completed, total });
    });
  }

  return checklist;
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
