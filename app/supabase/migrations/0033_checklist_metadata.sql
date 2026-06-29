-- Publish module, step 2: persisted Darwin Core / EML-shaped checklist
-- metadata, captured before DwC-A package generation. One row per
-- checklist (checklist_metadata) plus an ordered list of contributors
-- (checklist_contributors). RLS mirrors the checklists table: members can
-- read, editor+ can write (via auth_is_member/auth_has_role from
-- 0001_init.sql).

create table checklist_metadata (
  checklist_id uuid primary key references checklists(id) on delete cascade,
  keywords text[] not null default '{}',
  language text not null default 'English',
  short_description text,
  purpose text,
  abstract text,
  dataset_type text not null default 'Species Checklist',
  temporal_earliest_year int,
  temporal_latest_year int,
  temporal_coverage_description text,
  geo_country text,
  geo_state text,
  geo_region_name text,
  geo_bounding_box text,
  geo_elevation_range text,
  geo_description text,
  geo_checklist_type text,
  taxonomic_scope_description text,
  methods_data_sources text[] not null default '{}',
  methodology text,
  taxonomic_validation text,
  evidence_evaluation text,
  criteria text,
  reviewer_notes text,
  publishing_org_name text,
  publishing_org_website text,
  institution_code text,
  publishing_contact text,
  resource_contact text,
  license text,
  rights_statement text,
  usage_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table checklist_contributors (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  name text not null,
  role text not null default 'Creator',
  institution text,
  orcid text,
  email text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index checklist_contributors_checklist_idx on checklist_contributors (checklist_id, position);

alter table checklist_metadata enable row level security;
alter table checklist_contributors enable row level security;

create policy "checklist_metadata_select_members" on checklist_metadata
  for select to authenticated using (auth_is_member(checklist_id));

create policy "checklist_metadata_write_editor" on checklist_metadata
  for all to authenticated
  using (auth_has_role(checklist_id, 'editor'))
  with check (auth_has_role(checklist_id, 'editor'));

create policy "checklist_contributors_select_members" on checklist_contributors
  for select to authenticated using (auth_is_member(checklist_id));

create policy "checklist_contributors_write_editor" on checklist_contributors
  for all to authenticated
  using (auth_has_role(checklist_id, 'editor'))
  with check (auth_has_role(checklist_id, 'editor'));

-- Upserts the metadata row and replaces the full contributors list in one
-- transaction, so the API route stays a single-RPC-call wrapper instead of
-- chaining several Postgrest calls (see AGENTS.md).
create or replace function upsert_checklist_metadata(
  p_checklist_id uuid,
  p_metadata jsonb,
  p_contributors jsonb -- array of { name, role, institution, orcid, email }
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to edit this checklist.' using errcode = '42501';
  end if;

  insert into checklist_metadata (
    checklist_id, keywords, language, short_description, purpose, abstract,
    dataset_type, temporal_earliest_year, temporal_latest_year,
    temporal_coverage_description, geo_country, geo_state, geo_region_name,
    geo_bounding_box, geo_elevation_range, geo_description, geo_checklist_type,
    taxonomic_scope_description, methods_data_sources, methodology,
    taxonomic_validation, evidence_evaluation, criteria, reviewer_notes,
    publishing_org_name, publishing_org_website, institution_code,
    publishing_contact, resource_contact, license, rights_statement,
    usage_notes, updated_at
  )
  values (
    p_checklist_id,
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_metadata->'keywords')), '{}'),
    coalesce(p_metadata->>'language', 'English'),
    p_metadata->>'short_description',
    p_metadata->>'purpose',
    p_metadata->>'abstract',
    coalesce(p_metadata->>'dataset_type', 'Species Checklist'),
    (p_metadata->>'temporal_earliest_year')::int,
    (p_metadata->>'temporal_latest_year')::int,
    p_metadata->>'temporal_coverage_description',
    p_metadata->>'geo_country',
    p_metadata->>'geo_state',
    p_metadata->>'geo_region_name',
    p_metadata->>'geo_bounding_box',
    p_metadata->>'geo_elevation_range',
    p_metadata->>'geo_description',
    p_metadata->>'geo_checklist_type',
    p_metadata->>'taxonomic_scope_description',
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_metadata->'methods_data_sources')), '{}'),
    p_metadata->>'methodology',
    p_metadata->>'taxonomic_validation',
    p_metadata->>'evidence_evaluation',
    p_metadata->>'criteria',
    p_metadata->>'reviewer_notes',
    p_metadata->>'publishing_org_name',
    p_metadata->>'publishing_org_website',
    p_metadata->>'institution_code',
    p_metadata->>'publishing_contact',
    p_metadata->>'resource_contact',
    p_metadata->>'license',
    p_metadata->>'rights_statement',
    p_metadata->>'usage_notes',
    now()
  )
  on conflict (checklist_id) do update set
    keywords = excluded.keywords,
    language = excluded.language,
    short_description = excluded.short_description,
    purpose = excluded.purpose,
    abstract = excluded.abstract,
    dataset_type = excluded.dataset_type,
    temporal_earliest_year = excluded.temporal_earliest_year,
    temporal_latest_year = excluded.temporal_latest_year,
    temporal_coverage_description = excluded.temporal_coverage_description,
    geo_country = excluded.geo_country,
    geo_state = excluded.geo_state,
    geo_region_name = excluded.geo_region_name,
    geo_bounding_box = excluded.geo_bounding_box,
    geo_elevation_range = excluded.geo_elevation_range,
    geo_description = excluded.geo_description,
    geo_checklist_type = excluded.geo_checklist_type,
    taxonomic_scope_description = excluded.taxonomic_scope_description,
    methods_data_sources = excluded.methods_data_sources,
    methodology = excluded.methodology,
    taxonomic_validation = excluded.taxonomic_validation,
    evidence_evaluation = excluded.evidence_evaluation,
    criteria = excluded.criteria,
    reviewer_notes = excluded.reviewer_notes,
    publishing_org_name = excluded.publishing_org_name,
    publishing_org_website = excluded.publishing_org_website,
    institution_code = excluded.institution_code,
    publishing_contact = excluded.publishing_contact,
    resource_contact = excluded.resource_contact,
    license = excluded.license,
    rights_statement = excluded.rights_statement,
    usage_notes = excluded.usage_notes,
    updated_at = now();

  delete from checklist_contributors where checklist_id = p_checklist_id;

  insert into checklist_contributors (checklist_id, name, role, institution, orcid, email, position)
  select
    p_checklist_id,
    c->>'name',
    coalesce(c->>'role', 'Creator'),
    c->>'institution',
    c->>'orcid',
    c->>'email',
    (row_number() over () - 1)::int
  from jsonb_array_elements(coalesce(p_contributors, '[]'::jsonb)) as c
  where coalesce(c->>'name', '') <> '';

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function upsert_checklist_metadata(uuid, jsonb, jsonb) to authenticated;
