-- Two bugs reported against the workbench:
--
-- 1. "Review Status Agree/Reject buttons are not working." Two compounding
--    causes:
--    a) cast_review_vote looked up the caller's existing vote by
--       (species_id, reviewer_id) only, with no column distinguishing a
--       review vote (accept/reject) from a synonym vote (agree/disagree).
--       Both kinds of vote are cast through this same RPC into the same
--       species_reviews row, so casting a synonym agree/disagree on a row
--       silently overwrote that user's prior accept/reject review vote on
--       the SAME row (and vice versa). Fix: add vote_type and scope every
--       lookup/insert by it, so the two vote kinds no longer share a slot.
--    b) review_status only flipped to accepted/rejected once EVERY
--       collaborator on the checklist had cast the same decision — on any
--       checklist with more than one collaborator, a single Agree click
--       visibly does nothing. Per product decision, this is changed to the
--       same single-user model already used for taxonomy resolution (0020):
--       the current user's own accept/reject immediately sets review_status.
--
-- 2. "Synonyms shows NONE, not 1, after resolving an outdated row." Some rows
--    reach taxonomy_status = 'synonym' via the authority_conflict-resolution
--    trigger (sync_taxonomy_status_from_conflicts, see 0009/0011), which only
--    compares taxonomy->>'imported_name' vs taxonomy->>'current_name' — it
--    never requires (or populates) a taxonomy.synonyms timeline entry. Rows
--    that arrive at 'synonym' status this way have an empty synonyms array,
--    so after resolve_species_taxonomy marks them 'accepted' there's still
--    nothing to show. Fix: resolve_species_taxonomy now ensures the imported
--    name is recorded in the synonyms timeline (adding an entry if missing,
--    tagging its outcome) whenever it resolves a 'synonym' row, so the
--    Synonyms count always reflects the resolution that just happened.

alter table species_reviews
  add column vote_type text not null default 'review' check (vote_type in ('review', 'synonym'));

-- Best-effort backfill for any existing rows: a decision of agree/disagree
-- could only have come from the synonym-vote UI path.
update species_reviews set vote_type = 'synonym' where decision in ('agree', 'disagree');

create or replace function cast_review_vote(
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
  v_vote_type       text;
  v_existing_id     uuid;
  v_existing_decision text;
  v_remaining_decision text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('accept', 'reject', 'agree', 'disagree') then
    raise exception 'decision must be ''accept'', ''reject'', ''agree'', or ''disagree''.' using errcode = '22023';
  end if;

  v_vote_type := case when p_decision in ('accept', 'reject') then 'review' else 'synonym' end;

  perform 1 from species where id = p_species_id and checklist_id = p_checklist_id;
  if not found then
    raise exception 'Species not found.' using errcode = 'P0002';
  end if;

  select id, decision into v_existing_id, v_existing_decision
  from species_reviews
  where species_id = p_species_id and reviewer_id = v_uid and vote_type = v_vote_type;

  if v_existing_decision = p_decision then
    delete from species_reviews where id = v_existing_id;

    if v_vote_type = 'review' then
      -- Un-voting reverts to whatever the species' OTHER collaborators still
      -- have on record, not straight to not_reviewed — a checklist with
      -- several reviewers shouldn't have one person's un-click blow away
      -- everyone else's standing vote.
      select decision into v_remaining_decision
      from species_reviews
      where species_id = p_species_id and vote_type = 'review'
      order by created_at desc
      limit 1;

      update species
      set review_status = case v_remaining_decision
        when 'accept' then 'accepted'::review_status
        when 'reject' then 'rejected'::review_status
        else 'not_reviewed'::review_status
      end
      where id = p_species_id;
    end if;

    return jsonb_build_object('ok', true, 'voted', false);
  elsif v_existing_id is not null then
    update species_reviews set decision = p_decision where id = v_existing_id;
  else
    insert into species_reviews (species_id, reviewer_id, decision, target, vote_type)
    values (p_species_id, v_uid, p_decision, '{}'::jsonb, v_vote_type);
  end if;

  -- review_status (accept/reject) no longer waits on every collaborator —
  -- same single-user model already used for taxonomy resolution (0020) and
  -- the synonym Agree/Update flow: the current user's own decision is enough
  -- to unlock it. agree/disagree synonym votes never touch review_status —
  -- the taxonomy state transition stays the exclusive responsibility of
  -- resolve_species_taxonomy.
  if v_vote_type = 'review' then
    update species
    set review_status = case p_decision when 'accept' then 'accepted'::review_status else 'rejected'::review_status end
    where id = p_species_id;
  end if;

  return jsonb_build_object('ok', true, 'voted', true);
end;
$func$;

grant execute on function cast_review_vote(uuid, uuid, text) to authenticated;

create or replace function resolve_species_taxonomy(
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
  v_imported_name   text;
  v_current_name    text;
  v_synonyms        jsonb;
  v_match_idx       int;
  v_outcome         text;
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

  -- Ensure the imported (outdated) name is present in the synonyms timeline
  -- with an outcome reflecting this resolution. Some 'synonym' rows reach that
  -- status purely from a name-mismatch check (no timeline entry ever
  -- recorded) — without this, the row would show "Synonyms: NONE" forever
  -- even after being correctly resolved.
  if v_taxonomy_status = 'synonym' then
    v_imported_name := v_taxonomy->>'imported_name';
    v_current_name := v_taxonomy->>'current_name';
    v_outcome := case when p_decision = 'agree' then 'rejected' else 'accepted' end;

    if v_imported_name is not null and v_imported_name <> coalesce(v_current_name, '') then
      v_synonyms := coalesce(v_taxonomy->'synonyms', '[]'::jsonb);

      select (ord - 1) into v_match_idx
      from jsonb_array_elements(v_synonyms) with ordinality as t(elem, ord)
      where elem->>'name' = v_imported_name
      limit 1;

      if v_match_idx is not null then
        v_synonyms := jsonb_set(v_synonyms, array[v_match_idx::text, 'outcome'], to_jsonb(v_outcome));
      else
        v_synonyms := v_synonyms || jsonb_build_array(
          jsonb_build_object(
            'event_type', 'synonym',
            'name', v_imported_name,
            'outcome', v_outcome
          )
        );
      end if;

      v_taxonomy := v_taxonomy || jsonb_build_object('synonyms', v_synonyms);
    end if;
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
