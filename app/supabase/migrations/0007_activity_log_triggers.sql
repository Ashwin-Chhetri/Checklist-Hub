-- Populate activity_log automatically so the Workbench sidebar's
-- "Recent Changes" / "Recent Comments" / "History Timeline" views have data.
-- Additive only: does not modify any existing table/column.

-- ============================================================
-- species: review_status changes -> 'review_status_changed'
-- ============================================================

create function log_species_review_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.review_status is distinct from old.review_status then
    insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
    values (
      new.checklist_id,
      auth.uid(),
      'review_status_changed',
      'species',
      new.id,
      jsonb_build_object(
        'scientific_name', new.scientific_name,
        'from', old.review_status,
        'to', new.review_status
      )
    );
  end if;
  return new;
end;
$$;

create trigger species_review_status_activity
  after update on species
  for each row execute procedure log_species_review_status_change();

-- ============================================================
-- species_comments: new comment -> 'comment_added'
-- ============================================================

create function log_species_comment_activity()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_checklist_id uuid;
  v_scientific_name text;
begin
  select checklist_id, scientific_name into v_checklist_id, v_scientific_name
  from species where id = new.species_id;

  insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
  values (
    v_checklist_id,
    new.author_id,
    'comment_added',
    'species_comment',
    new.id,
    jsonb_build_object(
      'species_id', new.species_id,
      'scientific_name', v_scientific_name,
      'body', new.body
    )
  );
  return new;
end;
$$;

create trigger species_comment_activity
  after insert on species_comments
  for each row execute procedure log_species_comment_activity();

-- ============================================================
-- taxonomy_votes: agree/disagree -> 'taxonomy_vote'
-- ============================================================

create function log_taxonomy_vote_activity()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_checklist_id uuid;
  v_species_id uuid;
  v_scientific_name text;
  v_suggested_name text;
begin
  select species.checklist_id, species.id, species.scientific_name, taxonomy_conflicts.suggested_name
  into v_checklist_id, v_species_id, v_scientific_name, v_suggested_name
  from taxonomy_conflicts
  join species on species.id = taxonomy_conflicts.species_id
  where taxonomy_conflicts.id = new.conflict_id;

  insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
  values (
    v_checklist_id,
    new.voter_id,
    'taxonomy_vote',
    'taxonomy_conflict',
    new.conflict_id,
    jsonb_build_object(
      'species_id', v_species_id,
      'scientific_name', v_scientific_name,
      'suggested_name', v_suggested_name,
      'decision', new.decision
    )
  );
  return new;
end;
$$;

create trigger taxonomy_vote_activity
  after insert on taxonomy_votes
  for each row execute procedure log_taxonomy_vote_activity();
