-- Species mentions in comments + notification triggers so collaborators are
-- alerted about mentions, replies, taxonomy votes, and review decisions.
-- Additive only: does not modify any existing table/column.

-- ============================================================
-- species_comments: track species referenced (e.g. "#Strix leptogrammica")
-- ============================================================

alter table species_comments
  add column mentioned_species uuid[] not null default '{}';

-- ============================================================
-- species_comments: @user mentions -> 'mention' notification
-- ============================================================

create function notify_comment_mentions()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_checklist_id uuid;
  v_scientific_name text;
  v_user_id uuid;
begin
  select checklist_id, scientific_name into v_checklist_id, v_scientific_name
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
          'body', new.body
        )
      );
    end if;
  end loop;

  return new;
end;
$$;

create trigger species_comment_mention_notify
  after insert on species_comments
  for each row execute procedure notify_comment_mentions();

-- ============================================================
-- species_comments: reply to a thread -> 'comment_reply' notification
-- ============================================================

create function notify_comment_reply()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_checklist_id uuid;
  v_scientific_name text;
  v_parent_author uuid;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  select author_id into v_parent_author
  from species_comments where id = new.parent_comment_id;

  if v_parent_author is null or v_parent_author = new.author_id then
    return new;
  end if;

  select checklist_id, scientific_name into v_checklist_id, v_scientific_name
  from species where id = new.species_id;

  insert into notifications (user_id, checklist_id, species_id, type, payload)
  values (
    v_parent_author,
    v_checklist_id,
    new.species_id,
    'comment_reply',
    jsonb_build_object(
      'comment_id', new.id,
      'actor_id', new.author_id,
      'scientific_name', v_scientific_name,
      'body', new.body
    )
  );

  return new;
end;
$$;

create trigger species_comment_reply_notify
  after insert on species_comments
  for each row execute procedure notify_comment_reply();

-- ============================================================
-- species_comments: notify checklist owner of new discussion activity
-- ============================================================

create function notify_comment_owner()
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
    insert into notifications (user_id, checklist_id, species_id, type, payload)
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
      )
    );
  end if;

  return new;
end;
$$;

create trigger species_comment_owner_notify
  after insert on species_comments
  for each row execute procedure notify_comment_owner();

-- ============================================================
-- taxonomy_votes: notify checklist owner of agree/disagree
-- ============================================================

create function notify_taxonomy_vote()
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
    insert into notifications (user_id, checklist_id, species_id, type, payload)
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
      )
    );
  end if;

  return new;
end;
$$;

create trigger taxonomy_vote_notify
  after insert on taxonomy_votes
  for each row execute procedure notify_taxonomy_vote();

-- ============================================================
-- species: review_status changes -> notify checklist owner
-- ============================================================

create function notify_review_status_change()
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
      insert into notifications (user_id, checklist_id, species_id, type, payload)
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
        )
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger species_review_status_notify
  after update on species
  for each row execute procedure notify_review_status_change();
