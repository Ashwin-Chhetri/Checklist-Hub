-- Collapses the collaborator role system to a flat full-access model.
-- collaborator_role and the role column stay (still distinguish 'owner' for
-- ownership-only actions like rename/delete checklist), but every non-owner
-- role now ranks identically to 'editor' so any collaborator has full
-- content access. Invite/creation RPCs stop accepting a caller-chosen role
-- and always grant 'editor'. update_collaborator_role is dropped (nothing
-- left to change); a new remove_collaborator_from_checklist RPC lets the
-- owner remove a collaborator instead.

-- ============================================================
-- role_rank: collapse editor/reviewer/commenter/viewer to one rank
-- ============================================================

create or replace function role_rank(p_role collaborator_role)
returns int
language sql
immutable
as $$
  select case p_role
    when 'owner' then 5
    when 'editor' then 4
    when 'reviewer' then 4
    when 'commenter' then 4
    when 'viewer' then 4
    else 0
  end;
$$;

-- ============================================================
-- invite_collaborator_to_checklist: drop p_role, always grant 'editor'
-- ============================================================

drop function if exists invite_collaborator_to_checklist(uuid, text, collaborator_role, text);

create function invite_collaborator_to_checklist(
  p_checklist_id uuid,
  p_email        text,
  p_note         text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid       uuid;
  v_role      collaborator_role;
  v_owner_id  uuid;
  v_email     text;
  v_matched   uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select role into v_role
  from checklist_collaborators
  where checklist_id = p_checklist_id and user_id = v_uid;

  if v_role is null or v_role not in ('owner', 'editor') then
    select owner_id into v_owner_id from checklists where id = p_checklist_id;
    if v_owner_id is distinct from v_uid then
      raise exception 'Editor access required.' using errcode = '42501';
    end if;
  end if;

  v_email := lower(trim(p_email));

  insert into checklist_invites (checklist_id, email, note, role, invited_by, status)
  values (p_checklist_id, v_email, p_note, 'editor', v_uid, 'pending')
  on conflict (checklist_id, email) do update set
    role = excluded.role,
    note = excluded.note;

  select id into v_matched from profiles where email = v_email;

  if v_matched is not null then
    insert into checklist_collaborators (checklist_id, user_id, role, invited_by)
    values (p_checklist_id, v_matched, 'editor', v_uid)
    on conflict (checklist_id, user_id) do update set role = excluded.role;

    update checklist_invites
    set status = 'accepted', responded_at = now()
    where checklist_id = p_checklist_id and email = v_email;

    insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
    select v_matched, p_checklist_id, null, 'added_as_collaborator',
      jsonb_build_object('actor_id', v_uid, 'checklist_title', title), 1
    from checklists where id = p_checklist_id
    on conflict (user_id, checklist_id, type) where read = false and species_id is null
    do update set
      payload = excluded.payload,
      occurrence_count = notifications.occurrence_count + 1,
      created_at = now(),
      read = false;
  end if;

  return jsonb_build_object('ok', true, 'matched', v_matched is not null, 'email', v_email);
end;
$func$;

grant execute on function invite_collaborator_to_checklist(uuid, text, text) to authenticated;

-- ============================================================
-- create_checklist_with_species: hardcode 'editor' for invites
-- ============================================================

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
    region_district, region_gadm_id, region_pin, taxonomic_scope, status, owner_id)
  select p_checklist->>'title', p_checklist->>'region_name', p_checklist->>'region_country',
    p_checklist->>'region_state', p_checklist->>'region_district', p_checklist->>'region_gadm_id',
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

  -- checklist_collaborators for invites matching an existing profile by email
  insert into checklist_collaborators (checklist_id, user_id, role, invited_by)
  select v_checklist_id, p.id, 'editor', v_uid
  from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) inv
  join profiles p on p.email = inv->>'email'
  on conflict (checklist_id, user_id) do nothing;

  -- checklist_invites for ALL invites (status reflects whether matched to an
  -- existing profile, for audit/notification purposes)
  insert into checklist_invites (checklist_id, email, note, role, invited_by, status)
  select v_checklist_id, inv->>'email', inv->>'note',
    'editor', v_uid,
    case when exists (select 1 from profiles where email = inv->>'email') then 'accepted'::invite_status else 'pending'::invite_status end
  from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) inv;

  -- notify matched profiles immediately (mirrors invite_collaborator_to_checklist)
  insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
  select p.id, v_checklist_id, null, 'added_as_collaborator',
    jsonb_build_object('actor_id', v_uid, 'checklist_title', p_checklist->>'title'), 1
  from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) inv
  join profiles p on p.email = inv->>'email'
  on conflict (user_id, checklist_id, type) where read = false and species_id is null
  do update set
    payload = excluded.payload,
    occurrence_count = notifications.occurrence_count + 1,
    created_at = now(),
    read = false;

  return v_checklist_id;
end;
$func$;

-- ============================================================
-- update_collaborator_role: no longer needed, every role is full access
-- ============================================================

drop function if exists update_collaborator_role(uuid, uuid, collaborator_role);

-- ============================================================
-- remove_collaborator_from_checklist: owner removes a collaborator
-- ============================================================

create function remove_collaborator_from_checklist(
  p_checklist_id uuid,
  p_user_id      uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid      uuid;
  v_owner_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'owner') then
    raise exception 'Owner access required.' using errcode = '42501';
  end if;

  select owner_id into v_owner_id from checklists where id = p_checklist_id;
  if v_owner_id = p_user_id then
    raise exception 'Cannot remove the checklist owner.' using errcode = '42501';
  end if;

  delete from checklist_collaborators
  where checklist_id = p_checklist_id and user_id = p_user_id;

  if not found then
    raise exception 'Collaborator not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end;
$func$;

grant execute on function remove_collaborator_from_checklist(uuid, uuid) to authenticated;
