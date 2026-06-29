-- Fixes a case-sensitivity bug in the invite -> signup bridge: emails are
-- lowercased when an invite is created (invite_collaborator_to_checklist),
-- but compared against raw-case emails (auth.users.email / profiles.email)
-- in handle_new_user and create_checklist_with_species. Any casing
-- difference between what the inviter typed and what the invitee typed at
-- signup meant the bridge silently matched zero rows: no
-- checklist_collaborators row was ever created, so the checklist never
-- loaded and never appeared in any organizer tab for that user.

-- ============================================================
-- handle_new_user: case-insensitive match on pending invites
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_invite record;
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    new.email
  );

  for v_invite in
    select * from checklist_invites
    where lower(trim(email)) = lower(trim(new.email)) and status = 'pending'
    for update
  loop
    insert into checklist_collaborators (checklist_id, user_id, role, invited_by)
    values (v_invite.checklist_id, new.id, v_invite.role, v_invite.invited_by)
    on conflict (checklist_id, user_id) do nothing;

    update checklist_invites
    set status = 'accepted', responded_at = now()
    where id = v_invite.id;

    insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
    select new.id, v_invite.checklist_id, null, 'added_as_collaborator',
      jsonb_build_object('actor_id', v_invite.invited_by, 'checklist_title', title), 1
    from checklists where id = v_invite.checklist_id
    on conflict (user_id, checklist_id, type) where read = false and species_id is null
    do update set
      payload = excluded.payload,
      occurrence_count = notifications.occurrence_count + 1,
      created_at = now(),
      read = false;
  end loop;

  return new;
end;
$$;

-- ============================================================
-- invite_collaborator_to_checklist: case-insensitive profiles lookup
-- ============================================================

create or replace function invite_collaborator_to_checklist(
  p_checklist_id uuid,
  p_email        text,
  p_role         collaborator_role,
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
  values (p_checklist_id, v_email, p_note, p_role, v_uid, 'pending')
  on conflict (checklist_id, email) do update set
    role = excluded.role,
    note = excluded.note;

  select id into v_matched from profiles where lower(trim(email)) = v_email;

  if v_matched is not null then
    insert into checklist_collaborators (checklist_id, user_id, role, invited_by)
    values (p_checklist_id, v_matched, p_role, v_uid)
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

-- ============================================================
-- create_checklist_with_species: lowercase invite emails on write,
-- case-insensitive profiles match
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
          else null
        end,
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

  -- Add invited users who already have an account as collaborators immediately.
  -- Without this, auth_has_role() returns false for them and they cannot access
  -- the checklist even though they were invited.
  insert into checklist_collaborators (checklist_id, user_id, role, invited_by)
  select v_checklist_id, p.id, coalesce((item->>'role')::collaborator_role, 'viewer'), v_uid
  from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) item
  join profiles p on lower(trim(p.email)) = lower(trim(item->>'email'));

  if jsonb_array_length(coalesce(p_invites, '[]'::jsonb)) > 0 then
    insert into checklist_invites (checklist_id, email, note, role, invited_by, status)
    select v_checklist_id, lower(trim(item->>'email')), item->>'note',
      coalesce((item->>'role')::collaborator_role, 'viewer'), v_uid,
      case when exists (select 1 from profiles where lower(trim(email)) = lower(trim(item->>'email')))
        then 'accepted'::invite_status
        else 'pending'::invite_status
      end
    from jsonb_array_elements(p_invites) item;
  end if;

  return v_checklist_id;
end;
$func$;

-- ============================================================
-- One-time backfill: reconcile pending invites that already have a
-- matching (case-insensitive) profile, so the previously-affected user
-- doesn't need to be re-invited.
-- ============================================================

insert into checklist_collaborators (checklist_id, user_id, role, invited_by)
select ci.checklist_id, p.id, ci.role, ci.invited_by
from checklist_invites ci
join profiles p on lower(trim(p.email)) = lower(trim(ci.email))
where ci.status = 'pending'
on conflict (checklist_id, user_id) do nothing;

update checklist_invites ci
set status = 'accepted', responded_at = now()
where ci.status = 'pending'
  and exists (
    select 1 from profiles p where lower(trim(p.email)) = lower(trim(ci.email))
  );

insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
select p.id, ci.checklist_id, null, 'added_as_collaborator',
  jsonb_build_object('actor_id', ci.invited_by, 'checklist_title', c.title), 1
from checklist_invites ci
join profiles p on lower(trim(p.email)) = lower(trim(ci.email))
join checklists c on c.id = ci.checklist_id
where ci.status = 'accepted' and ci.responded_at >= now() - interval '1 minute'
on conflict (user_id, checklist_id, type) where read = false and species_id is null
do update set
  payload = excluded.payload,
  occurrence_count = notifications.occurrence_count + 1,
  created_at = now(),
  read = false;
