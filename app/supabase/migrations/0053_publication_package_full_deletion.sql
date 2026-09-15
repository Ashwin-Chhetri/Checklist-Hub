-- clear_checklist_publication_package (0039) only cleared the draft's live
-- package pointer. It never touched checklist_publication_versions, so
-- every saved version's snapshot zip (storage path
-- {checklist_id}/versions/{timestamp}/*.zip) — and the version rows
-- themselves — stayed behind forever: the "Delete package" action in the
-- checklist organizer, and a "Regenerate" action, both looked like they
-- deleted the package but actually left the full version history orphaned
-- in both Postgres and Storage.
--
-- This makes the function delete everything for that checklist: the draft
-- pointer (as before) and every checklist_publication_versions row, and
-- return every storage path involved (the draft's own package plus each
-- version's) so the caller can remove the actual objects from the Storage
-- bucket too — a Postgres delete never touches Storage on its own.
create or replace function clear_checklist_publication_package(
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

  update checklist_publication_drafts
  set package_storage_path = null,
      package_generated_at = null,
      stage = 'metadata',
      updated_at = now()
  where checklist_id = p_checklist_id;

  with deleted as (
    delete from checklist_publication_versions
    where checklist_id = p_checklist_id
    returning package_storage_path
  )
  select coalesce(array_agg(package_storage_path) filter (where package_storage_path is not null), array[]::text[])
  into v_version_paths
  from deleted;

  v_all_paths := v_version_paths;
  if v_draft_path is not null then
    v_all_paths := array_append(v_all_paths, v_draft_path);
  end if;

  return jsonb_build_object('ok', true, 'storage_paths', to_jsonb(v_all_paths));
end;
$func$;

grant execute on function clear_checklist_publication_package(uuid) to authenticated;
