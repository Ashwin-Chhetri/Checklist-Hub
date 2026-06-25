-- Two additive changes:
-- 1. species.comment_count — a denormalized counter so the Workbench row's
--    comment icon doesn't need a per-row query across a list that can have
--    thousands of rows. Maintained by a trigger on species_comments.
-- 2. Notification grouping — ambient "activity" notifications (taxonomy
--    votes, review status changes, comment-added-to-owner, and the newer
--    authority-conflict/merge/taxonomy-resolution actions) collapse into a
--    single updated row per (user, species, type) instead of accumulating
--    one row per event. Direct/personal notifications (@mentions, replies)
--    are untouched — those stay one-per-event.

-- ============================================================
-- 1. species.comment_count
-- ============================================================

alter table species add column comment_count int not null default 0;

create function bump_species_comment_count()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update species set comment_count = comment_count + 1 where id = new.species_id;
    return new;
  elsif tg_op = 'DELETE' then
    update species set comment_count = greatest(comment_count - 1, 0) where id = old.species_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger species_comments_count
  after insert or delete on species_comments
  for each row execute procedure bump_species_comment_count();

-- ============================================================
-- 2. Notification grouping
-- ============================================================

alter table notifications add column occurrence_count int not null default 1;

create unique index notifications_grouping_unread_idx
  on notifications (user_id, species_id, type)
  where read = false and species_id is not null;

-- notify_comment_mentions: unchanged grouping behavior (stays 1-per-event,
-- personal/direct), but now also carries common_name in the payload.
create or replace function notify_comment_mentions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_checklist_id uuid;
  v_scientific_name text;
  v_common_name text;
  v_user_id uuid;
begin
  select checklist_id, scientific_name, common_name into v_checklist_id, v_scientific_name, v_common_name
  from species where id = new.species_id;

  foreach v_user_id in array new.mentions loop
    if v_user_id is distinct from new.author_id then
      insert into notifications (user_id, checklist_id, species_id, type, payload)
      values (
        v_user_id,
        v_checklist_id,
        new.species_id,
        'mention',
        jsonb_build_object(
          'comment_id', new.id,
          'actor_id', new.author_id,
          'scientific_name', v_scientific_name,
          'common_name', v_common_name,
          'body', new.body
        )
      );
    end if;
  end loop;

  return new;
end;
$$;

-- notify_comment_owner: ambient activity -> grouped.
create or replace function notify_comment_owner()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_checklist_id uuid;
  v_owner_id uuid;
  v_scientific_name text;
begin
  select species.checklist_id, species.scientific_name, checklists.owner_id
  into v_checklist_id, v_scientific_name, v_owner_id
  from species
  join checklists on checklists.id = species.checklist_id
  where species.id = new.species_id;

  if v_owner_id is distinct from new.author_id then
    insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
    values (
      v_owner_id,
      v_checklist_id,
      new.species_id,
      'comment_added',
      jsonb_build_object(
        'comment_id', new.id,
        'actor_id', new.author_id,
        'scientific_name', v_scientific_name,
        'body', new.body
      ),
      1
    )
    on conflict (user_id, species_id, type) where read = false and species_id is not null
    do update set
      payload = excluded.payload,
      occurrence_count = notifications.occurrence_count + 1,
      created_at = now(),
      read = false;
  end if;

  return new;
end;
$$;

-- notify_taxonomy_vote: ambient activity -> grouped.
create or replace function notify_taxonomy_vote()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_checklist_id uuid;
  v_species_id uuid;
  v_owner_id uuid;
  v_scientific_name text;
  v_suggested_name text;
begin
  select species.checklist_id, species.id, species.scientific_name, taxonomy_conflicts.suggested_name, checklists.owner_id
  into v_checklist_id, v_species_id, v_scientific_name, v_suggested_name, v_owner_id
  from taxonomy_conflicts
  join species on species.id = taxonomy_conflicts.species_id
  join checklists on checklists.id = species.checklist_id
  where taxonomy_conflicts.id = new.conflict_id;

  if v_owner_id is distinct from new.voter_id then
    insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
    values (
      v_owner_id,
      v_checklist_id,
      v_species_id,
      'taxonomy_vote',
      jsonb_build_object(
        'actor_id', new.voter_id,
        'scientific_name', v_scientific_name,
        'suggested_name', v_suggested_name,
        'decision', new.decision
      ),
      1
    )
    on conflict (user_id, species_id, type) where read = false and species_id is not null
    do update set
      payload = excluded.payload,
      occurrence_count = notifications.occurrence_count + 1,
      created_at = now(),
      read = false;
  end if;

  return new;
end;
$$;

-- notify_review_status_change: ambient activity -> grouped.
create or replace function notify_review_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if new.review_status is distinct from old.review_status then
    select owner_id into v_owner_id from checklists where id = new.checklist_id;

    if v_owner_id is distinct from auth.uid() then
      insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
      values (
        v_owner_id,
        new.checklist_id,
        new.id,
        'review_status_changed',
        jsonb_build_object(
          'actor_id', auth.uid(),
          'scientific_name', new.scientific_name,
          'from', old.review_status,
          'to', new.review_status
        ),
        1
      )
      on conflict (user_id, species_id, type) where read = false and species_id is not null
      do update set
        payload = excluded.payload,
        occurrence_count = notifications.occurrence_count + 1,
        created_at = now(),
        read = false;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- New activity types from 0016's RPCs currently produce no notification at
-- all. Add a grouped owner-notification insert to each, same shape as above.
-- ============================================================

create or replace function resolve_authority_conflict(
  p_species_id     uuid,
  p_checklist_id    uuid,
  p_scientific_name text,
  p_gbif_taxon_key  bigint,
  p_evidence        jsonb,
  p_hierarchy       jsonb,
  p_taxonomy        jsonb,
  p_related_ids     uuid[]
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

  update species
  set scientific_name = p_scientific_name,
      gbif_taxon_key   = coalesce(p_gbif_taxon_key, gbif_taxon_key),
      evidence         = p_evidence,
      taxonomy_status  = 'accepted',
      kingdom          = coalesce(p_hierarchy->>'kingdom', kingdom),
      phylum           = coalesce(p_hierarchy->>'phylum', phylum),
      class            = coalesce(p_hierarchy->>'class', class),
      "order"          = coalesce(p_hierarchy->>'order', "order"),
      family           = coalesce(p_hierarchy->>'family', family),
      genus            = coalesce(p_hierarchy->>'genus', genus),
      taxonomy         = p_taxonomy
  where id = p_species_id and checklist_id = p_checklist_id;

  if not found then
    raise exception 'Species not found.' using errcode = 'P0002';
  end if;

  if p_related_ids is not null and array_length(p_related_ids, 1) > 0 then
    update species
    set is_active = false, merged_into_species_id = p_species_id
    where id = any(p_related_ids);
  end if;

  update taxonomy_conflicts
  set status = 'resolved'
  where species_id = p_species_id and status <> 'resolved';

  insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
  values (
    p_checklist_id, v_uid, 'authority_conflict_resolved', 'species', p_species_id,
    jsonb_build_object('scientific_name', p_scientific_name, 'merged_count', coalesce(array_length(p_related_ids, 1), 0))
  );

  select owner_id into v_owner_id from checklists where id = p_checklist_id;
  if v_owner_id is distinct from v_uid then
    insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
    values (
      v_owner_id, p_checklist_id, p_species_id, 'authority_conflict_resolved',
      jsonb_build_object('actor_id', v_uid, 'scientific_name', p_scientific_name), 1
    )
    on conflict (user_id, species_id, type) where read = false and species_id is not null
    do update set
      payload = excluded.payload,
      occurrence_count = notifications.occurrence_count + 1,
      created_at = now(),
      read = false;
  end if;

  return jsonb_build_object(
    'ok', true,
    'accepted_name', p_scientific_name,
    'merged_count', coalesce(array_length(p_related_ids, 1), 0)
  );
end;
$func$;

create or replace function resolve_species_taxonomy(
  p_species_id   uuid,
  p_checklist_id uuid,
  p_decision     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid             uuid;
  v_taxonomy        jsonb;
  v_taxonomy_status taxonomy_status;
  v_name_resolution jsonb;
  v_scientific_name text;
  v_owner_id        uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('agree', 'disagree', 'defer') then
    raise exception 'decision must be ''agree'', ''disagree'', or ''defer''.' using errcode = '22023';
  end if;

  select taxonomy, taxonomy_status, scientific_name into v_taxonomy, v_taxonomy_status, v_scientific_name
  from species
  where id = p_species_id and checklist_id = p_checklist_id;

  if not found then
    raise exception 'Species not found.' using errcode = 'P0002';
  end if;

  v_taxonomy := coalesce(v_taxonomy, '{}'::jsonb);
  v_name_resolution := jsonb_build_object(
    'decision', p_decision,
    'resolved_by', v_uid,
    'resolved_at', now()
  );

  if p_decision = 'defer' then
    if v_taxonomy_status = 'authority_conflict' then
      update taxonomy_conflicts
      set status = 'under_review'
      where species_id = p_species_id and status = 'found';
    end if;

    update species
    set taxonomy = v_taxonomy || jsonb_build_object('name_resolution', v_name_resolution)
    where id = p_species_id and checklist_id = p_checklist_id;

    return jsonb_build_object('ok', true, 'decision', p_decision);
  end if;

  if v_taxonomy_status = 'authority_conflict' then
    update taxonomy_conflicts
    set status = 'resolved'
    where species_id = p_species_id and status <> 'resolved';
  end if;

  update species
  set taxonomy = v_taxonomy || jsonb_build_object('name_resolution', v_name_resolution),
      taxonomy_status = 'accepted'
  where id = p_species_id and checklist_id = p_checklist_id;

  insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
  values (
    p_checklist_id, v_uid, 'taxonomy_resolved', 'species', p_species_id,
    jsonb_build_object('decision', p_decision, 'scientific_name', v_scientific_name)
  );

  select owner_id into v_owner_id from checklists where id = p_checklist_id;
  if v_owner_id is distinct from v_uid then
    insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
    values (
      v_owner_id, p_checklist_id, p_species_id, 'taxonomy_resolved',
      jsonb_build_object('actor_id', v_uid, 'scientific_name', v_scientific_name, 'decision', p_decision), 1
    )
    on conflict (user_id, species_id, type) where read = false and species_id is not null
    do update set
      payload = excluded.payload,
      occurrence_count = notifications.occurrence_count + 1,
      created_at = now(),
      read = false;
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$func$;

create or replace function cast_conflict_vote(
  p_species_id     uuid,
  p_checklist_id    uuid,
  p_authority       text,
  p_suggested_name  text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid             uuid;
  v_conflict_id     uuid;
  v_existing_vote   uuid;
  v_all_collab_ids  uuid[];
  v_conflict        record;
  v_agree_ids       uuid[];
  v_resolved        boolean := false;
  v_scientific_name text;
  v_owner_id        uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select scientific_name into v_scientific_name
  from species where id = p_species_id and checklist_id = p_checklist_id;
  if v_scientific_name is null then
    raise exception 'Species not found.' using errcode = 'P0002';
  end if;

  select id into v_conflict_id
  from taxonomy_conflicts
  where species_id = p_species_id and authority = p_authority and suggested_name = p_suggested_name;

  if v_conflict_id is null then
    insert into taxonomy_conflicts (species_id, authority, suggested_name, status)
    values (p_species_id, p_authority, p_suggested_name, 'found')
    returning id into v_conflict_id;
  end if;

  select id into v_existing_vote
  from taxonomy_votes
  where conflict_id = v_conflict_id and voter_id = v_uid;

  if v_existing_vote is not null then
    delete from taxonomy_votes where id = v_existing_vote;
    return jsonb_build_object('ok', true, 'voted', false);
  end if;

  insert into taxonomy_votes (conflict_id, voter_id, decision)
  values (v_conflict_id, v_uid, 'agree');

  select array_agg(distinct uid) into v_all_collab_ids
  from (
    select owner_id as uid from checklists where id = p_checklist_id
    union
    select user_id as uid from checklist_collaborators where checklist_id = p_checklist_id
  ) ids
  where uid is not null;

  if coalesce(array_length(v_all_collab_ids, 1), 0) >= 2 then
    for v_conflict in
      select id from taxonomy_conflicts
      where species_id = p_species_id and status <> 'resolved'
    loop
      select array_agg(voter_id) into v_agree_ids
      from taxonomy_votes
      where conflict_id = v_conflict.id and decision = 'agree';

      if coalesce(v_agree_ids, '{}') @> v_all_collab_ids then
        update taxonomy_conflicts set status = 'resolved' where species_id = p_species_id;
        update species set taxonomy_status = 'accepted' where id = p_species_id;
        v_resolved := true;
        exit;
      end if;
    end loop;
  end if;

  if v_resolved then
    insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
    values (
      p_checklist_id, v_uid, 'authority_conflict_resolved', 'species', p_species_id,
      jsonb_build_object('scientific_name', v_scientific_name, 'resolved_by', 'consensus')
    );

    select owner_id into v_owner_id from checklists where id = p_checklist_id;
    if v_owner_id is distinct from v_uid then
      insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
      values (
        v_owner_id, p_checklist_id, p_species_id, 'authority_conflict_resolved',
        jsonb_build_object('actor_id', v_uid, 'scientific_name', v_scientific_name, 'resolved_by', 'consensus'), 1
      )
      on conflict (user_id, species_id, type) where read = false and species_id is not null
      do update set
        payload = excluded.payload,
        occurrence_count = notifications.occurrence_count + 1,
        created_at = now(),
        read = false;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'voted', true);
end;
$func$;

create or replace function merge_species(
  p_species_id        uuid,
  p_checklist_id       uuid,
  p_target_species_id  uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid             uuid;
  v_role            collaborator_role;
  v_owner_id        uuid;
  v_synonym_active  boolean;
  v_target_active   boolean;
  v_scientific_name text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  if p_species_id = p_target_species_id then
    raise exception 'Cannot merge a species into itself.' using errcode = '22023';
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

  select is_active, scientific_name into v_synonym_active, v_scientific_name
  from species where id = p_species_id and checklist_id = p_checklist_id;

  if not found then
    raise exception 'Species not found in this checklist.' using errcode = 'P0002';
  end if;
  if v_synonym_active is false then
    raise exception 'Species row is already inactive.' using errcode = '22023';
  end if;

  select is_active into v_target_active
  from species where id = p_target_species_id and checklist_id = p_checklist_id;

  if not found then
    raise exception 'Target species not found in this checklist.' using errcode = 'P0002';
  end if;
  if v_target_active is false then
    raise exception 'Target species row is inactive and cannot be merged into.' using errcode = '22023';
  end if;

  update species
  set is_active = false, merged_into_species_id = p_target_species_id
  where id = p_species_id;

  insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
  values (
    p_checklist_id, v_uid, 'species_merged', 'species', p_species_id,
    jsonb_build_object('target_species_id', p_target_species_id, 'scientific_name', v_scientific_name)
  );

  select owner_id into v_owner_id from checklists where id = p_checklist_id;
  if v_owner_id is distinct from v_uid then
    insert into notifications (user_id, checklist_id, species_id, type, payload, occurrence_count)
    values (
      v_owner_id, p_checklist_id, p_species_id, 'species_merged',
      jsonb_build_object('actor_id', v_uid, 'scientific_name', v_scientific_name, 'target_species_id', p_target_species_id), 1
    )
    on conflict (user_id, species_id, type) where read = false and species_id is not null
    do update set
      payload = excluded.payload,
      occurrence_count = notifications.occurrence_count + 1,
      created_at = now(),
      read = false;
  end if;

  return jsonb_build_object('ok', true, 'merged_into', p_target_species_id);
end;
$func$;
