-- delete_checklist_metadata (0039) deletes checklist_contributors,
-- checklist_metadata, and checklist_publication_drafts, but never touched
-- checklist_publication_versions (added later in 0044) — the same
-- orphaned-storage gap 0053 already closed for
-- clear_checklist_publication_package. A checklist with saved version
-- history whose metadata gets deleted left every version's snapshot zip
-- permanently behind in the publication-exports Storage bucket, with
-- nothing left in the UI to ever reach it again.
--
-- Fixes it the same way: delete every version row for the checklist too,
-- and return every storage path involved (the draft's own package plus
-- each version's) so the caller can remove the actual objects from Storage
-- — a Postgres delete never touches Storage on its own.
create or replace function delete_checklist_metadata(
  p_checklist_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_draft_path text;
  v_version_paths text[];
  v_all_paths text[];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to edit this checklist.' using errcode = '42501';
  end if;

  select package_storage_path into v_draft_path
  from checklist_publication_drafts
  where checklist_id = p_checklist_id;

  with deleted as (
    delete from checklist_publication_versions
    where checklist_id = p_checklist_id
    returning package_storage_path
  )
  select coalesce(array_agg(package_storage_path) filter (where package_storage_path is not null), array[]::text[])
  into v_version_paths
  from deleted;

  delete from checklist_contributors where checklist_id = p_checklist_id;
  delete from checklist_metadata where checklist_id = p_checklist_id;
  delete from checklist_publication_drafts where checklist_id = p_checklist_id;

  v_all_paths := v_version_paths;
  if v_draft_path is not null then
    v_all_paths := array_append(v_all_paths, v_draft_path);
  end if;

  return jsonb_build_object('ok', true, 'storage_paths', to_jsonb(v_all_paths));
end;
$func$;

grant execute on function delete_checklist_metadata(uuid) to authenticated;
