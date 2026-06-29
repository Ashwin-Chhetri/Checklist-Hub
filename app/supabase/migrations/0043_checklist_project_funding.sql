-- GBIF requires a projectID in EML for datasets funded through a GBIF
-- programme (BID/BIFA/CESP) — "a GUID or other identifier that is near
-- globally unique... required for BID projects" (GBIF data quality
-- requirements for checklists). Maps to EML <project id="...">, with
-- project_title/funding_description feeding <project><title>/<funding>.
-- is_funded gates whether the EML builder emits <project> at all — most
-- checklists aren't programme-funded, and that's a legitimate, common case.

alter table checklist_metadata
  add column is_funded boolean not null default false,
  add column project_id text,
  add column project_title text,
  add column funding_description text;

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
    publishing_organization_id, publishing_org_name, publishing_org_website,
    institution_code, publishing_contact, resource_contact, license,
    rights_statement, usage_notes, dataset_version, gbif_doi,
    gbif_publication_year, gbif_citation, gbif_dataset_uuid, ipt_published_at,
    is_funded, project_id, project_title, funding_description, updated_at
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
    (p_metadata->>'publishing_organization_id')::uuid,
    p_metadata->>'publishing_org_name',
    p_metadata->>'publishing_org_website',
    p_metadata->>'institution_code',
    p_metadata->>'publishing_contact',
    p_metadata->>'resource_contact',
    p_metadata->>'license',
    p_metadata->>'rights_statement',
    p_metadata->>'usage_notes',
    coalesce(p_metadata->>'dataset_version', '1.0'),
    p_metadata->>'gbif_doi',
    (p_metadata->>'gbif_publication_year')::int,
    p_metadata->>'gbif_citation',
    p_metadata->>'gbif_dataset_uuid',
    (p_metadata->>'ipt_published_at')::timestamptz,
    coalesce((p_metadata->>'is_funded')::boolean, false),
    p_metadata->>'project_id',
    p_metadata->>'project_title',
    p_metadata->>'funding_description',
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
    publishing_organization_id = excluded.publishing_organization_id,
    publishing_org_name = excluded.publishing_org_name,
    publishing_org_website = excluded.publishing_org_website,
    institution_code = excluded.institution_code,
    publishing_contact = excluded.publishing_contact,
    resource_contact = excluded.resource_contact,
    license = excluded.license,
    rights_statement = excluded.rights_statement,
    usage_notes = excluded.usage_notes,
    dataset_version = excluded.dataset_version,
    gbif_doi = excluded.gbif_doi,
    gbif_publication_year = excluded.gbif_publication_year,
    gbif_citation = excluded.gbif_citation,
    gbif_dataset_uuid = excluded.gbif_dataset_uuid,
    ipt_published_at = excluded.ipt_published_at,
    is_funded = excluded.is_funded,
    project_id = excluded.project_id,
    project_title = excluded.project_title,
    funding_description = excluded.funding_description,
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
