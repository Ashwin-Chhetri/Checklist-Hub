-- GBIF generates the official, citable reference for a published dataset
-- (title + authors + publishing org + year + DOI, assigned once the
-- DwC-A package is published through IPT) — ChecklistHub never mints its
-- own DOI or citation. What ChecklistHub needs is a place to *record* that
-- official citation once it exists, plus the handful of fields (version,
-- DOI) GBIF's citation depends on. Until then the publish metadata page
-- still shows a locally generated draft, clearly labeled as a preview, not
-- the citation of record.

alter table checklist_metadata
  add column dataset_version text not null default '1.0',
  add column gbif_doi text,
  add column gbif_publication_year int,
  add column gbif_citation text;

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
    usage_notes, dataset_version, gbif_doi, gbif_publication_year,
    gbif_citation, updated_at
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
    coalesce(p_metadata->>'dataset_version', '1.0'),
    p_metadata->>'gbif_doi',
    (p_metadata->>'gbif_publication_year')::int,
    p_metadata->>'gbif_citation',
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
    dataset_version = excluded.dataset_version,
    gbif_doi = excluded.gbif_doi,
    gbif_publication_year = excluded.gbif_publication_year,
    gbif_citation = excluded.gbif_citation,
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
