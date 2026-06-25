-- cast_review_vote's INSERT/UPDATE of species_reviews.decision (a
-- review_decision enum) passed p_decision straight through as plain text.
-- Postgres only auto-casts an *untyped literal* into an enum column;
-- a plpgsql text variable has no implicit text->enum assignment cast, so
-- every AGREE/DISAGREE click was failing server-side with: column
-- "decision" is of type review_decision but expression is of type text.
-- This bug shipped in 0023 and was carried forward into 0025's rewrite —
-- fixed here by casting p_decision::review_decision at both write sites.

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
    update species_reviews set decision = p_decision::review_decision where id = v_existing_id;
    v_voted := true;
  else
    insert into species_reviews (species_id, reviewer_id, decision, target, vote_type)
    values (p_species_id, v_uid, p_decision::review_decision, '{}'::jsonb, v_vote_type);
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
