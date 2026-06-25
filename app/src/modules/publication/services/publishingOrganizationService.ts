import { createClient } from "@/lib/supabase/client";
import type { PublishingOrganization } from "@/types/checklist.types";

export type PublishingOrganizationInput = Omit<
  PublishingOrganization,
  "id" | "owner_id" | "created_at" | "updated_at"
> & { id?: string | null };

/** All publishing organizations owned by (or linked to a checklist the current user is a member of) the signed-in user — RLS-scoped. */
export async function listMyPublishingOrganizations(): Promise<PublishingOrganization[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("publishing_organizations")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as PublishingOrganization[];
}

/** Creates (input.id unset) or updates (ownership-checked) a publishing organization profile. Returns its id. */
export async function upsertPublishingOrganization(input: PublishingOrganizationInput): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_publishing_organization", {
    p_id: input.id ?? null,
    p_name: input.name,
    p_website: input.website ?? null,
    p_institution_code: input.institution_code ?? null,
    p_contact_name: input.contact_name ?? null,
    p_contact_email: input.contact_email ?? null,
    p_endorsement_status: input.endorsement_status ?? "not_started",
    p_endorsement_requested_at: input.endorsement_requested_at ?? null,
    p_endorsement_notes: input.endorsement_notes ?? null,
    p_ipt_access_status: input.ipt_access_status ?? "not_started",
    p_ipt_instance_name: input.ipt_instance_name ?? null,
    p_ipt_instance_url: input.ipt_instance_url ?? null,
    p_ipt_organization_key: input.ipt_organization_key ?? null,
    p_gbif_registry_org_uuid: input.gbif_registry_org_uuid ?? null,
  });

  if (error) throw error;
  return (data as { id: string }).id;
}

/** Links (organizationId) or unlinks (null) a checklist to a publishing organization. */
export async function setChecklistPublishingOrganization(
  checklistId: string,
  organizationId: string | null,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_checklist_publishing_organization", {
    p_checklist_id: checklistId,
    p_organization_id: organizationId,
  });
  if (error) throw error;
}
