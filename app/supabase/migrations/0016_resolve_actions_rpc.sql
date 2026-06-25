-- Collapse the multi-step Postgrest call chains used by the species action
-- routes (resolve-conflict, resolve-taxonomy, conflict-vote, review-vote,
-- merge) into single security-definer RPC calls, following the pattern
-- already established in 0006_create_checklist_with_species_security_definer.sql.
-- Each route previously made 3-8 sequential round trips to Supabase from the
-- Next.js server; each now makes one `supabase.rpc(...)` call instead.
-- Additive only: no existing table/column is dropped or modified.

-- ============================================================
-- resolve_authority_conflict
-- Used by POST /api/checklists/[id]/species/[speciesId]/resolve-conflict.
-- The route still does its own SELECTs and the local SQLite backbone lookup
-- in Node (that data isn't in Postgres), then calls this once with the fully
-- computed update payload instead of issuing 3 sequential .update() calls.
-- ============================================================

create function resolve_authority_conflict(
  p_species_id     uuid,
  p_checklist_id    uuid,
  p_scientific_name text,
  p_gbif_taxon_key  bigint,
  p_evidence        jsonb,
  p_hierarchy       jsonb,   -- partial: only fields to override (kingdom/phylum/class/order/family/genus)
  p_taxonomy        jsonb,   -- full taxonomy jsonb to set
  p_related_ids     uuid[]   -- other duplicate-group rows to soft-merge into this one
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
    p_checklist_id, auth.uid(), 'authority_conflict_resolved', 'species', p_species_id,
    jsonb_build_object('scientific_name', p_scientific_name, 'merged_count', coalesce(array_length(p_related_ids, 1), 0))
  );

  return jsonb_build_object(
    'ok', true,
    'accepted_name', p_scientific_name,
    'merged_count', coalesce(array_length(p_related_ids, 1), 0)
  );
end;
$func$;

grant execute on function resolve_authority_conflict(uuid, uuid, text, bigint, jsonb, jsonb, jsonb, uuid[]) to authenticated;

-- ============================================================
-- resolve_species_taxonomy
-- Used by POST /api/checklists/[id]/species/[speciesId]/resolve-taxonomy.
-- ============================================================

create function resolve_species_taxonomy(
  p_species_id   uuid,
  p_checklist_id uuid,
  p_decision     text -- 'agree' | 'disagree' | 'defer'
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
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('agree', 'disagree', 'defer') then
    raise exception 'decision must be ''agree'', ''disagree'', or ''defer''.' using errcode = '22023';
  end if;

  select taxonomy, taxonomy_status into v_taxonomy, v_taxonomy_status
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

  -- agree or disagree: record the decision and mark as reviewed. scientific_name
  -- is intentionally NOT updated here — same as the original route behavior.
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
  select p_checklist_id, v_uid, 'taxonomy_resolved', 'species', p_species_id,
    jsonb_build_object('decision', p_decision, 'scientific_name', scientific_name)
  from species where id = p_species_id;

  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$func$;

grant execute on function resolve_species_taxonomy(uuid, uuid, text) to authenticated;

-- ============================================================
-- cast_conflict_vote
-- Used by POST /api/checklists/[id]/species/[speciesId]/conflict-vote.
-- Toggles the caller's AGREE vote on a conflict card; auto-resolves all open
-- conflicts for the species if every collaborator (≥2) has agreed on one.
-- ============================================================

create function cast_conflict_vote(
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
  v_uid            uuid;
  v_conflict_id    uuid;
  v_existing_vote  uuid;
  v_all_collab_ids uuid[];
  v_conflict       record;
  v_agree_ids      uuid[];
  v_resolved       boolean := false;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  perform 1 from species where id = p_species_id and checklist_id = p_checklist_id;
  if not found then
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

  -- Consensus check: all collaborators (owner + checklist_collaborators)
  -- agreed on the same conflict card. Requires at least 2 collaborators.
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
        -- Explicit, not just relying on the sync trigger: if every conflict row was
        -- already 'resolved' beforehand the trigger's UPDATE matches zero rows and
        -- never runs, leaving the species stuck on 'authority_conflict'.
        update species set taxonomy_status = 'accepted' where id = p_species_id;
        v_resolved := true;
        exit;
      end if;
    end loop;
  end if;

  if v_resolved then
    insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
    select p_checklist_id, v_uid, 'authority_conflict_resolved', 'species', p_species_id,
      jsonb_build_object('scientific_name', scientific_name, 'resolved_by', 'consensus')
    from species where id = p_species_id;
  end if;

  return jsonb_build_object('ok', true, 'voted', true);
end;
$func$;

grant execute on function cast_conflict_vote(uuid, uuid, text, text) to authenticated;

-- ============================================================
-- cast_review_vote
-- Used by POST /api/checklists/[id]/species/[speciesId]/review-vote.
-- Toggles the caller's accept/reject/agree/disagree vote on a species row;
-- applies the consensus outcome to species.review_status/taxonomy_status.
-- ============================================================

create function cast_review_vote(
  p_species_id   uuid,
  p_checklist_id uuid,
  p_decision     text -- 'accept' | 'reject' | 'agree' | 'disagree'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid             uuid;
  v_existing_id     uuid;
  v_existing_decision text;
  v_all_collab_ids  uuid[];
  v_accept_ids      uuid[];
  v_reject_ids      uuid[];
  v_agree_ids       uuid[];
  v_disagree_ids    uuid[];
  v_total_votes     int;
  v_current_review_status text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('accept', 'reject', 'agree', 'disagree') then
    raise exception 'decision must be ''accept'', ''reject'', ''agree'', or ''disagree''.' using errcode = '22023';
  end if;

  perform 1 from species where id = p_species_id and checklist_id = p_checklist_id;
  if not found then
    raise exception 'Species not found.' using errcode = 'P0002';
  end if;

  select id, decision into v_existing_id, v_existing_decision
  from species_reviews
  where species_id = p_species_id and reviewer_id = v_uid;

  if v_existing_decision = p_decision then
    delete from species_reviews where id = v_existing_id;
    return jsonb_build_object('ok', true, 'voted', false);
  elsif v_existing_id is not null then
    update species_reviews set decision = p_decision where id = v_existing_id;
  else
    insert into species_reviews (species_id, reviewer_id, decision, target)
    values (p_species_id, v_uid, p_decision, '{}'::jsonb);
  end if;

  select array_agg(distinct uid) into v_all_collab_ids
  from (
    select owner_id as uid from checklists where id = p_checklist_id
    union
    select user_id as uid from checklist_collaborators where checklist_id = p_checklist_id
  ) ids
  where uid is not null;

  select array_agg(reviewer_id) filter (where decision = 'accept'),
         array_agg(reviewer_id) filter (where decision = 'reject'),
         array_agg(reviewer_id) filter (where decision = 'agree'),
         array_agg(reviewer_id) filter (where decision = 'disagree'),
         count(*)
  into v_accept_ids, v_reject_ids, v_agree_ids, v_disagree_ids, v_total_votes
  from species_reviews
  where species_id = p_species_id;

  if coalesce(v_accept_ids, '{}') @> v_all_collab_ids then
    update species set review_status = 'accepted' where id = p_species_id;
  elsif coalesce(v_reject_ids, '{}') @> v_all_collab_ids then
    update species set review_status = 'rejected' where id = p_species_id;
  elsif coalesce(v_agree_ids, '{}') @> v_all_collab_ids then
    update species set taxonomy_status = 'accepted' where id = p_species_id;
  elsif coalesce(v_disagree_ids, '{}') @> v_all_collab_ids then
    null; -- all disagreed -> keep as synonym, no change needed
  elsif v_total_votes > 0 then
    select review_status into v_current_review_status from species where id = p_species_id;
    if v_current_review_status = 'not_reviewed' then
      update species set review_status = 'under_review' where id = p_species_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'voted', true);
end;
$func$;

grant execute on function cast_review_vote(uuid, uuid, text) to authenticated;

-- ============================================================
-- merge_species
-- Used by POST /api/checklists/[id]/species/[speciesId]/merge.
-- ============================================================

create function merge_species(
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

  return jsonb_build_object('ok', true, 'merged_into', p_target_species_id);
end;
$func$;

grant execute on function merge_species(uuid, uuid, uuid) to authenticated;
