-- Publish wizard progress is currently held only in React state
-- (app/src/app/checklists/[id]/publish/page.tsx) — navigate away and it's
-- gone. This table persists which stage a checklist's in-progress
-- publication has reached, so the checklist organizer can show a resumable
-- "publication in progress" row and the wizard can jump straight back to
-- where the user left off. One row per checklist, replaced (not appended)
-- as the user progresses — this is live progress, not history (that's what
-- checklist_publication_snapshots, 0034, is for).

create table checklist_publication_drafts (
  checklist_id uuid primary key references checklists(id) on delete cascade,
  stage text not null default 'metadata' check (stage in ('metadata', 'review')),
  package_storage_path text,
  package_generated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table checklist_publication_drafts enable row level security;

create policy "checklist_publication_drafts_select_members" on checklist_publication_drafts
  for select to authenticated using (auth_is_member(checklist_id));

create policy "checklist_publication_drafts_write_editor" on checklist_publication_drafts
  for all to authenticated
  using (auth_has_role(checklist_id, 'editor'))
  with check (auth_has_role(checklist_id, 'editor'));

create or replace function upsert_checklist_publication_draft(
  p_checklist_id uuid,
  p_stage text,
  p_package_storage_path text default null,
  p_package_generated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to edit this checklist.' using errcode = '42501';
  end if;

  insert into checklist_publication_drafts (
    checklist_id, stage, package_storage_path, package_generated_at, updated_at
  ) values (
    p_checklist_id, p_stage, p_package_storage_path, p_package_generated_at, now()
  )
  on conflict (checklist_id) do update set
    stage = excluded.stage,
    package_storage_path = coalesce(excluded.package_storage_path, checklist_publication_drafts.package_storage_path),
    package_generated_at = coalesce(excluded.package_generated_at, checklist_publication_drafts.package_generated_at),
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function upsert_checklist_publication_draft(uuid, text, text, timestamptz) to authenticated;

create or replace function delete_checklist_publication_draft(
  p_checklist_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to edit this checklist.' using errcode = '42501';
  end if;

  delete from checklist_publication_drafts where checklist_id = p_checklist_id;

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function delete_checklist_publication_draft(uuid) to authenticated;

-- Re-declared from 0034 with one addition: publishing clears the in-progress
-- draft row, since the publication is no longer "in progress" once it's done.
create or replace function record_checklist_publication(
  p_checklist_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid;
  v_species_count int;
  v_family_count int;
  v_genus_count int;
  v_order_count int;
  v_species_ids uuid[];
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to publish this checklist.' using errcode = '42501';
  end if;

  select
    count(*),
    count(distinct family) filter (where family is not null),
    count(distinct genus) filter (where genus is not null),
    count(distinct "order") filter (where "order" is not null),
    coalesce(array_agg(id), '{}')
  into v_species_count, v_family_count, v_genus_count, v_order_count, v_species_ids
  from species
  where checklist_id = p_checklist_id
    and review_status = 'accepted'
    and is_active = true;

  update checklists set status = 'published' where id = p_checklist_id;

  insert into checklist_publication_snapshots (
    checklist_id, species_count, family_count, genus_count, order_count, species_ids, published_by
  ) values (
    p_checklist_id, v_species_count, v_family_count, v_genus_count, v_order_count, v_species_ids, v_uid
  );

  delete from checklist_publication_drafts where checklist_id = p_checklist_id;

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function record_checklist_publication(uuid) to authenticated;
