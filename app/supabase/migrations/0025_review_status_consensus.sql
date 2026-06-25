-- Product change to species review (AGREE/DISAGREE on the Review Status
-- column): a single user's Agree now accepts a row immediately, but if any
-- OTHER collaborator then Disagrees on the same row, it falls back to
-- not_reviewed (neutral) instead of flipping straight to rejected — it only
-- becomes accepted/rejected again once every collaborator who has voted is
-- unanimous. Previously cast_review_vote just overwrote review_status with
-- whichever decision was cast most recently, so one collaborator's Disagree
-- could silently stomp another's standing Agree instead of going neutral.
--
-- Also backfills the supabase_realtime publication: species, species_reviews,
-- species_comments, and activity_log are read/patched live by the workbench's
-- per-checklist realtime channel (useChecklistRealtimeChannel), but no
-- migration on record ever added them to supabase_realtime — they were
-- presumably toggled on by hand in the dashboard at some point. Re-asserting
-- them here (idempotently) removes the dependency on that out-of-band step,
-- since a vote that doesn't reach the calling user's own browser via realtime
-- looks exactly like "the button doesn't do anything" until a manual reload.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'species'
  ) then
    alter publication supabase_realtime add table species;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'species_reviews'
  ) then
    alter publication supabase_realtime add table species_reviews;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'species_comments'
  ) then
    alter publication supabase_realtime add table species_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_log'
  ) then
    alter publication supabase_realtime add table activity_log;
  end if;
end $$;

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
  v_uid               uuid;
  v_vote_type         text;
  v_existing_id       uuid;
  v_existing_decision text;
  v_voted             boolean;
  v_accept_count      int;
  v_reject_count      int;
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
    v_voted := false;
  elsif v_existing_id is not null then
    update species_reviews set decision = p_decision where id = v_existing_id;
    v_voted := true;
  else
    insert into species_reviews (species_id, reviewer_id, decision, target, vote_type)
    values (p_species_id, v_uid, p_decision, '{}'::jsonb, v_vote_type);
    v_voted := true;
  end if;

  if v_vote_type = 'review' then
    -- Recompute from every standing review vote on this row (not just the
    -- one just cast): accepted only if every voter agrees accept, rejected
    -- only if every voter agrees reject, otherwise (no votes, or a mix)
    -- not_reviewed. This is "unanimous among whoever has actually voted" —
    -- it does NOT require every checklist collaborator to vote, just that
    -- nobody who did vote disagrees.
    select
      count(*) filter (where decision = 'accept'),
      count(*) filter (where decision = 'reject')
    into v_accept_count, v_reject_count
    from species_reviews
    where species_id = p_species_id and vote_type = 'review';

    update species
    set review_status = case
      when v_accept_count = 0 and v_reject_count = 0 then 'not_reviewed'::review_status
      when v_reject_count = 0 then 'accepted'::review_status
      when v_accept_count = 0 then 'rejected'::review_status
      else 'not_reviewed'::review_status
    end
    where id = p_species_id;
  end if;

  return jsonb_build_object('ok', true, 'voted', v_voted);
end;
$func$;

grant execute on function cast_review_vote(uuid, uuid, text) to authenticated;
