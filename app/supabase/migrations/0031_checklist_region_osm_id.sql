-- Adds region_osm_type/region_osm_id to checklists. GADM only stores a
-- boundary polygon for level-2 (district) GIDs (see scripts/build-gadm.mjs)
-- — any region whose lookup falls back to a state/country-level GID (e.g.
-- Sikkim, whose Nominatim address tagging doesn't yield a clean district)
-- has no GADM geometry at all. Persisting the OSM element the user actually
-- selected lets the Evidence panel fetch a real boundary straight from
-- Nominatim for those regions instead of showing a blank map. Additive only.

alter table checklists add column region_osm_type text;
alter table checklists add column region_osm_id text;

-- Update create_checklist_with_species to also store the new fields (same
-- function as 0015, with region_osm_type/region_osm_id added to the insert).
create or replace function create_checklist_with_species(
  p_checklist jsonb,
  p_species   jsonb,
  p_invites   jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid          uuid;
  v_checklist_id uuid;
  v_species      jsonb;
  v_species_id   uuid;
  v_item         jsonb;
  v_tax_status   taxonomy_status;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into checklists (title, region_name, region_country, region_state,
    region_district, region_gadm_id, region_osm_type, region_osm_id, region_pin,
    taxonomic_scope, status, owner_id)
  select p_checklist->>'title', p_checklist->>'region_name', p_checklist->>'region_country',
    p_checklist->>'region_state', p_checklist->>'region_district', p_checklist->>'region_gadm_id',
    p_checklist->>'region_osm_type', p_checklist->>'region_osm_id',
    p_checklist->>'region_pin',
    coalesce(p_checklist->'taxonomic_scope', '{}'::jsonb),
    coalesce(p_checklist->>'status', 'draft')::checklist_status, v_uid
  returning id into v_checklist_id;

  for v_species in select * from jsonb_array_elements(coalesce(p_species, '[]'::jsonb))
  loop
    v_tax_status :=
      case
        when (v_species->>'taxonomy_status') = 'unresolved'
          then 'unresolved'::taxonomy_status
        when jsonb_array_length(coalesce(v_species->'taxonomy_conflicts', '[]'::jsonb)) > 0
          then 'authority_conflict'::taxonomy_status
        when (v_species->'taxonomy'->>'imported_name') is not null
          and (v_species->'taxonomy'->>'current_name') is not null
          and (v_species->'taxonomy'->>'imported_name') <> (v_species->'taxonomy'->>'current_name')
          then 'synonym'::taxonomy_status
        else 'accepted'::taxonomy_status
      end;

    insert into species (checklist_id, scientific_name, common_name, gbif_taxon_key,
      kingdom, phylum, class, "order", family, genus,
      identity, evidence, taxonomy, taxonomy_status)
    select v_checklist_id, v_species->>'scientific_name', v_species->>'common_name',
      (v_species->>'gbif_taxon_key')::bigint,
      v_species->'classification'->>'kingdom', v_species->'classification'->>'phylum',
      v_species->'classification'->>'class', v_species->'classification'->>'order',
      v_species->'classification'->>'family', v_species->'classification'->>'genus',
      coalesce(v_species->'identity', '{}'::jsonb),
      coalesce(v_species->'evidence', '{}'::jsonb),
      coalesce(v_species->'taxonomy', '{}'::jsonb),
      v_tax_status
    returning id into v_species_id;

    if jsonb_array_length(coalesce(v_species->'evidence_sources', '[]'::jsonb)) > 0 then
      insert into evidence_sources (species_id, source, occurrence_count, publication_count, last_updated)
      select v_species_id, item->>'source',
        coalesce((item->>'occurrence_count')::int, 0),
        coalesce((item->>'publication_count')::int, 0),
        (item->>'last_updated')::timestamptz
      from jsonb_array_elements(v_species->'evidence_sources') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'external_db_records', '[]'::jsonb)) > 0 then
      insert into external_db_records (species_id, source, external_id, record_count, last_updated)
      select v_species_id, item->>'source', item->>'external_id',
        coalesce((item->>'record_count')::int, 0),
        (item->>'last_updated')::timestamptz
      from jsonb_array_elements(v_species->'external_db_records') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'publications', '[]'::jsonb)) > 0 then
      insert into publications (species_id, title, authors, year, doi, link)
      select v_species_id, item->>'title',
        case when item->'authors' is not null
          then (select array_agg(a) from jsonb_array_elements_text(item->'authors') a)
          else null end,
        (item->>'year')::int, item->>'doi', item->>'link'
      from jsonb_array_elements(v_species->'publications') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'historical_mentions', '[]'::jsonb)) > 0 then
      insert into historical_mentions (species_id, year, source, note)
      select v_species_id, (item->>'year')::int, item->>'source', item->>'note'
      from jsonb_array_elements(v_species->'historical_mentions') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'taxonomy_conflicts', '[]'::jsonb)) > 0 then
      insert into taxonomy_conflicts (species_id, authority, suggested_name, status, notes)
      select v_species_id, item->>'authority', item->>'suggested_name',
        coalesce(item->>'status', 'found'), item->>'notes'
      from jsonb_array_elements(v_species->'taxonomy_conflicts') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'taxonomy_synonyms', '[]'::jsonb)) > 0 then
      insert into taxonomy_synonyms (species_id, year, event_type, name, authority)
      select v_species_id, (item->>'year')::int, item->>'event_type', item->>'name', item->>'authority'
      from jsonb_array_elements(v_species->'taxonomy_synonyms') item;
    end if;
  end loop;

  if jsonb_array_length(coalesce(p_invites, '[]'::jsonb)) > 0 then
    insert into checklist_invites (checklist_id, email, note, role, invited_by)
    select v_checklist_id, item->>'email', item->>'note',
      coalesce(item->>'role', 'viewer')::collaborator_role, v_uid
    from jsonb_array_elements(p_invites) item;
  end if;

  return v_checklist_id;
end;
$func$;
