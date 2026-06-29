-- Publish module, IPT handoff step 1: a "publishing organization" entity.
-- GBIF endorsement and IPT access are properties of an *organization*, not
-- of a single checklist — and one org may publish several checklists. There
-- is no organizations/tenancy concept anywhere else in this app (identity is
-- per-user `profiles`; `checklists.owner_id` is the only ownership link), so
-- this is modeled the same way checklists are: owned by a single user, with
-- checklists optionally linking to one via `checklist_metadata`. ChecklistHub
-- never talks to IPT or GBIF programmatically (see 0041/0042) — these fields
-- exist purely so the in-app "Publish via IPT" step can show real status
-- instead of asking the same setup questions for every checklist.

create type gbif_endorsement_status as enum ('not_started', 'requested', 'endorsed');
create type ipt_access_status as enum ('not_started', 'requested', 'granted');

create table publishing_organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  website text,
  institution_code text,
  contact_name text,
  contact_email text,
  endorsement_status gbif_endorsement_status not null default 'not_started',
  endorsement_requested_at timestamptz,
  endorsement_notes text,
  ipt_access_status ipt_access_status not null default 'not_started',
  ipt_instance_name text,
  ipt_instance_url text,
  ipt_organization_key text,
  gbif_registry_org_uuid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index publishing_organizations_owner_idx on publishing_organizations (owner_id);

alter table checklist_metadata
  add column publishing_organization_id uuid references publishing_organizations(id) on delete set null;

create index checklist_metadata_org_idx on checklist_metadata (publishing_organization_id);

alter table publishing_organizations enable row level security;

create policy "publishing_organizations_select_owner_or_linked_members" on publishing_organizations
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (
      select 1 from checklist_metadata cm
      where cm.publishing_organization_id = publishing_organizations.id
        and auth_is_member(cm.checklist_id)
    )
  );

create policy "publishing_organizations_write_owner" on publishing_organizations
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Creates (p_id null) or updates (ownership-checked) a publishing
-- organization profile and returns its id.
create or replace function upsert_publishing_organization(
  p_id uuid,
  p_name text,
  p_website text,
  p_institution_code text,
  p_contact_name text,
  p_contact_email text,
  p_endorsement_status gbif_endorsement_status,
  p_endorsement_requested_at timestamptz,
  p_endorsement_notes text,
  p_ipt_access_status ipt_access_status,
  p_ipt_instance_name text,
  p_ipt_instance_url text,
  p_ipt_organization_key text,
  p_gbif_registry_org_uuid text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid;
  v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_id is not null then
    update publishing_organizations set
      name = p_name,
      website = p_website,
      institution_code = p_institution_code,
      contact_name = p_contact_name,
      contact_email = p_contact_email,
      endorsement_status = p_endorsement_status,
      endorsement_requested_at = p_endorsement_requested_at,
      endorsement_notes = p_endorsement_notes,
      ipt_access_status = p_ipt_access_status,
      ipt_instance_name = p_ipt_instance_name,
      ipt_instance_url = p_ipt_instance_url,
      ipt_organization_key = p_ipt_organization_key,
      gbif_registry_org_uuid = p_gbif_registry_org_uuid,
      updated_at = now()
    where id = p_id and owner_id = v_uid
    returning id into v_id;

    if v_id is null then
      raise exception 'Not authorized to edit this publishing organization.' using errcode = '42501';
    end if;
  else
    insert into publishing_organizations (
      owner_id, name, website, institution_code, contact_name, contact_email,
      endorsement_status, endorsement_requested_at, endorsement_notes,
      ipt_access_status, ipt_instance_name, ipt_instance_url,
      ipt_organization_key, gbif_registry_org_uuid
    ) values (
      v_uid, p_name, p_website, p_institution_code, p_contact_name, p_contact_email,
      coalesce(p_endorsement_status, 'not_started'), p_endorsement_requested_at, p_endorsement_notes,
      coalesce(p_ipt_access_status, 'not_started'), p_ipt_instance_name, p_ipt_instance_url,
      p_ipt_organization_key, p_gbif_registry_org_uuid
    )
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$func$;

grant execute on function upsert_publishing_organization(
  uuid, text, text, text, text, text, gbif_endorsement_status, timestamptz, text,
  ipt_access_status, text, text, text, text
) to authenticated;

-- Links (or unlinks, when p_organization_id is null) a checklist to a
-- publishing organization. Editor-gated like upsert_checklist_metadata.
-- Denormalizes name/website/institution_code onto checklist_metadata so EML
-- generation (which only reads checklist_metadata) keeps working unchanged.
create or replace function set_checklist_publishing_organization(
  p_checklist_id uuid,
  p_organization_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_org record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to edit this checklist.' using errcode = '42501';
  end if;

  if p_organization_id is not null then
    select name, website, institution_code into v_org
    from publishing_organizations where id = p_organization_id;

    if not found then
      raise exception 'Publishing organization not found.' using errcode = '42704';
    end if;
  end if;

  insert into checklist_metadata (checklist_id, publishing_organization_id, publishing_org_name, publishing_org_website, institution_code, updated_at)
  values (p_checklist_id, p_organization_id, v_org.name, v_org.website, v_org.institution_code, now())
  on conflict (checklist_id) do update set
    publishing_organization_id = excluded.publishing_organization_id,
    publishing_org_name = coalesce(excluded.publishing_org_name, checklist_metadata.publishing_org_name),
    publishing_org_website = coalesce(excluded.publishing_org_website, checklist_metadata.publishing_org_website),
    institution_code = coalesce(excluded.institution_code, checklist_metadata.institution_code),
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function set_checklist_publishing_organization(uuid, uuid) to authenticated;
