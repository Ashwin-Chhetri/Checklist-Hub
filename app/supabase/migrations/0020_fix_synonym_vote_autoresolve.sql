-- cast_review_vote let agree/disagree vote consensus directly flip
-- species.taxonomy_status to 'accepted', bypassing the dedicated
-- resolve_species_taxonomy RPC that the Merge/Keep buttons are supposed to
-- be the sole trigger for. On a checklist with a single collaborator (the
-- owner), this fired on the very first "Agree" click, so the row jumped
-- straight to "resolved" without ever recording taxonomy.name_resolution or
-- writing an activity_log entry -- voting should only record the vote; the
-- actual taxonomy state transition stays the exclusive responsibility of
-- resolve_species_taxonomy.

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
  v_existing_id     uuid;
  v_existing_decision text;
  v_all_collab_ids  uuid[];
  v_accept_ids      uuid[];
  v_reject_ids      uuid[];
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
         count(*)
  into v_accept_ids, v_reject_ids, v_total_votes
  from species_reviews
  where species_id = p_species_id;

  if coalesce(v_accept_ids, '{}') @> v_all_collab_ids then
    update species set review_status = 'accepted' where id = p_species_id;
  elsif coalesce(v_reject_ids, '{}') @> v_all_collab_ids then
    update species set review_status = 'rejected' where id = p_species_id;
  elsif v_total_votes > 0 then
    select review_status into v_current_review_status from species where id = p_species_id;
    if v_current_review_status = 'not_reviewed' then
      update species set review_status = 'under_review' where id = p_species_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'voted', true);
end;
$func$;
