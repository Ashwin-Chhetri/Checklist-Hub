-- Adds species to an EXISTING checklist (the create-time bulk insert RPC
-- create_checklist_with_species only runs at checklist creation). Additive
-- only: no existing function, trigger, or column is modified.
--
-- Mirrors the per-species insert loop body of create_checklist_with_species
-- (current version, post-0011 taxonomy_status enum rework) so the same
-- taxonomy_status derivation and nested-table inserts apply consistently
-- whether species are added at creation time or afterward.
--
-- Also logs one activity_log row per inserted species (action
-- 'species_added') directly here, rather than via a generic
-- `after insert on species` trigger — a generic trigger would also fire
-- during the bulk checklist-creation insert (hundreds/thousands of rows at
-- once), which is not desired.

create function add_species_to_checklist(
  p_checklist_id uuid,
  p_species      jsonb
) returns uuid[]
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid          uuid;
  v_species      jsonb;
  v_species_id   uuid;
  v_tax_status   taxonomy_status;
  v_inserted_ids uuid[] := '{}';
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to add species to this checklist' using errcode = '42501';
  end if;

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
    select p_checklist_id, v_species->>'scientific_name', v_species->>'common_name',
      (v_species->>'gbif_taxon_key')::bigint,
      v_species->'classification'->>'kingdom', v_species->'classification'->>'phylum',
      v_species->'classification'->>'class', v_species->'classification'->>'order',
      v_species->'classification'->>'family', v_species->'classification'->>'genus',
      coalesce(v_species->'identity', '{}'::jsonb),
      coalesce(v_species->'evidence', '{}'::jsonb),
      coalesce(v_species->'taxonomy', '{}'::jsonb),
      v_tax_status
    returning id into v_species_id;

    v_inserted_ids := array_append(v_inserted_ids, v_species_id);

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

    insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
    values (
      p_checklist_id,
      v_uid,
      'species_added',
      'species',
      v_species_id,
      jsonb_build_object('scientific_name', v_species->>'scientific_name')
    );
  end loop;

  return v_inserted_ids;
end;
$func$;
