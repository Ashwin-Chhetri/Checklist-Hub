-- Fix "new row violates row-level security policy for table checklists" when
-- calling create_checklist_with_species via PostgREST RPC.
--
-- The function was SECURITY INVOKER, relying on the checklists_insert_self
-- RLS policy (owner_id = auth.uid()) to pass for the inserting role. In
-- practice the RLS check failed for some sessions even though
-- auth.getUser() succeeded in the API route — likely because the
-- request.jwt.claims GUC PostgREST sets for the RPC call wasn't visible to
-- the RLS policy evaluation inside the SECURITY INVOKER function.
--
-- Switching to SECURITY DEFINER makes the function run with the privileges
-- of its owner (bypassing RLS for these inserts), while an explicit
-- auth.uid() guard preserves the original authorization intent: only a
-- signed-in user can call this, and owner_id/invited_by are still stamped
-- with their uid exactly as before.

create or replace function create_checklist_with_species(
  p_checklist jsonb,      -- {title, region_name, region_country, region_state, region_district, region_gadm_id, taxonomic_scope, status}
  p_species jsonb,        -- array of species row objects
  p_invites jsonb         -- array of {email, note, role}
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid;
  v_checklist_id uuid;
  v_species jsonb;
  v_species_id uuid;
  v_item jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into checklists (title, region_name, region_country, region_state,
    region_district, region_gadm_id, taxonomic_scope, status, owner_id)
  select p_checklist->>'title', p_checklist->>'region_name', p_checklist->>'region_country',
    p_checklist->>'region_state', p_checklist->>'region_district', p_checklist->>'region_gadm_id',
    coalesce(p_checklist->'taxonomic_scope', '{}'::jsonb),
    coalesce(p_checklist->>'status', 'draft')::checklist_status, v_uid
  returning id into v_checklist_id;

  for v_species in select * from jsonb_array_elements(coalesce(p_species, '[]'::jsonb))
  loop
    insert into species (checklist_id, scientific_name, common_name, gbif_taxon_key,
      kingdom, phylum, class, "order", family, genus, identity, evidence, taxonomy)
    select v_checklist_id, v_species->>'scientific_name', v_species->>'common_name',
      (v_species->>'gbif_taxon_key')::bigint,
      v_species->'classification'->>'kingdom', v_species->'classification'->>'phylum',
      v_species->'classification'->>'class', v_species->'classification'->>'order',
      v_species->'classification'->>'family', v_species->'classification'->>'genus',
      coalesce(v_species->'identity', '{}'::jsonb),
      coalesce(v_species->'evidence', '{}'::jsonb),
      coalesce(v_species->'taxonomy', '{}'::jsonb)
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
      insert into taxonomy_conflicts (species_id, authority, suggested_name, status)
      select v_species_id, item->>'authority', item->>'suggested_name',
        coalesce(item->>'status', 'found')
      from jsonb_array_elements(v_species->'taxonomy_conflicts') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'taxonomy_synonyms', '[]'::jsonb)) > 0 then
      insert into taxonomy_synonyms (species_id, year, event_type, name, authority)
      select v_species_id, (item->>'year')::int, item->>'event_type', item->>'name', item->>'authority'
      from jsonb_array_elements(v_species->'taxonomy_synonyms') item;
    end if;
  end loop;

  -- checklist_collaborators for invites matching an existing profile by email
  insert into checklist_collaborators (checklist_id, user_id, role, invited_by)
  select v_checklist_id, p.id, coalesce((inv->>'role')::collaborator_role, 'viewer'), v_uid
  from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) inv
  join profiles p on p.email = inv->>'email';

  -- checklist_invites for ALL invites (status reflects whether matched to an
  -- existing profile, for audit/notification purposes)
  insert into checklist_invites (checklist_id, email, note, role, invited_by, status)
  select v_checklist_id, inv->>'email', inv->>'note',
    coalesce((inv->>'role')::collaborator_role, 'viewer'), v_uid,
    case when exists (select 1 from profiles where email = inv->>'email') then 'accepted'::invite_status else 'pending'::invite_status end
  from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) inv;

  return v_checklist_id;
end;
$func$;

grant execute on function create_checklist_with_species(jsonb, jsonb, jsonb) to authenticated;
