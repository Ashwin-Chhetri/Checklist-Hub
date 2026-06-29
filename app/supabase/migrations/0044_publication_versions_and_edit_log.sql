-- Editable package preview (taxon.txt/vernacularname.txt cell edits,
-- eml.xml/meta.xml raw-text edits) needs: (1) a permanent, browsable
-- version history — every save today overwrites the package zip in place
-- (fixed storage path, upsert: true) and checklist_publication_drafts is a
-- single mutable row, neither keeps history; (2) a way to log an edit as a
-- structured entry in the existing "Review Activity & Actions" feed
-- alongside human comments, which today only has freeform body + a
-- constrained decision enum.

-- ============================================================
-- 1. checklist_publication_versions — append-only, one row per save
-- ============================================================
create table checklist_publication_versions (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  version_number int not null,
  metadata_snapshot jsonb not null,
  contributors_snapshot jsonb not null,
  files jsonb not null, -- [{ name, contents }, ...] for all 7 package files
  package_storage_path text,
  change_summary text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (checklist_id, version_number)
);

create index checklist_publication_versions_checklist_idx
  on checklist_publication_versions (checklist_id, version_number desc);

alter table checklist_publication_versions enable row level security;

create policy "checklist_publication_versions_select_members" on checklist_publication_versions
  for select to authenticated using (auth_is_member(checklist_id));

-- No insert/update/delete policies for regular roles — written only via
-- create_publication_version (security definer) below, same pattern as
-- checklist_publication_snapshots.

-- ============================================================
-- 2. checklist_publication_comments: distinguish system edit-log entries
--    from human comments. Purely additive — doesn't touch the table's
--    append-only guarantee.
-- ============================================================
alter table checklist_publication_comments
  add column kind text not null default 'comment' check (kind in ('comment', 'edit')),
  add column payload jsonb;

-- ============================================================
-- 3. create_publication_version — snapshots the current package/metadata
--    state as a new version and logs it as an 'edit' activity entry.
-- ============================================================
create or replace function create_publication_version(
  p_checklist_id uuid,
  p_metadata_snapshot jsonb,
  p_contributors_snapshot jsonb,
  p_files jsonb,
  p_package_storage_path text,
  p_change_summary text,
  p_edited_file text
) returns int
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid;
  v_next_version int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'commenter') then
    raise exception 'Not authorized to edit this checklist''s publication package.' using errcode = '42501';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next_version
  from checklist_publication_versions
  where checklist_id = p_checklist_id;

  insert into checklist_publication_versions (
    checklist_id, version_number, metadata_snapshot, contributors_snapshot,
    files, package_storage_path, change_summary, created_by
  ) values (
    p_checklist_id, v_next_version, p_metadata_snapshot, p_contributors_snapshot,
    p_files, p_package_storage_path, p_change_summary, v_uid
  );

  insert into checklist_publication_comments (
    checklist_id, author_id, body, kind, payload
  ) values (
    p_checklist_id, v_uid, p_change_summary, 'edit',
    jsonb_build_object('version_number', v_next_version, 'file', p_edited_file)
  );

  return v_next_version;
end;
$func$;

grant execute on function create_publication_version(uuid, jsonb, jsonb, jsonb, text, text, text) to authenticated;

-- ============================================================
-- 4. apply_species_edits — writes back taxon.txt/vernacularname.txt cell
--    edits to the underlying species rows. Only the keys present in each
--    update object are touched; species_id is checked against
--    p_checklist_id so a stale/forged id from another checklist can't be
--    used to write into this one.
-- ============================================================
create or replace function apply_species_edits(
  p_checklist_id uuid,
  p_updates jsonb -- array of { species_id, scientific_name?, authorship?, kingdom?, phylum?, class?, "order"?, family?, genus?, common_name? }
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid;
  v_update jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'commenter') then
    raise exception 'Not authorized to edit this checklist''s species.' using errcode = '42501';
  end if;

  for v_update in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb))
  loop
    update species set
      scientific_name = coalesce(v_update->>'scientific_name', scientific_name),
      common_name = case when v_update ? 'common_name' then v_update->>'common_name' else common_name end,
      kingdom = case when v_update ? 'kingdom' then v_update->>'kingdom' else kingdom end,
      phylum = case when v_update ? 'phylum' then v_update->>'phylum' else phylum end,
      class = case when v_update ? 'class' then v_update->>'class' else class end,
      "order" = case when v_update ? 'order' then v_update->>'order' else "order" end,
      family = case when v_update ? 'family' then v_update->>'family' else family end,
      genus = case when v_update ? 'genus' then v_update->>'genus' else genus end,
      taxonomy = case
        when v_update ? 'authorship' then jsonb_set(taxonomy, '{authorship}', to_jsonb(v_update->>'authorship'))
        else taxonomy
      end,
      updated_at = now()
    where id = (v_update->>'species_id')::uuid
      and checklist_id = p_checklist_id;
  end loop;

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function apply_species_edits(uuid, jsonb) to authenticated;
