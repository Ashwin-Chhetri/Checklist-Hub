-- The checklist organizer now shows the in-progress metadata and DwC-A
-- package as two independent, deletable nested rows (rather than one
-- combined "draft" row). Deleting metadata means starting completely over
-- — also clears the draft pointer, since "what stage am I on" is
-- meaningless with no metadata. Deleting just the package keeps the
-- metadata but reverts the draft back to the metadata stage, since there's
-- no package to review anymore.
--
-- `clear_checklist_publication_package` exists separately from
-- `upsert_checklist_publication_draft` (0036) because that upsert
-- intentionally `coalesce`s package fields so saving progress never
-- clobbers an existing path — which means it can never be used to null one
-- back out.

create or replace function delete_checklist_metadata(
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

  delete from checklist_contributors where checklist_id = p_checklist_id;
  delete from checklist_metadata where checklist_id = p_checklist_id;
  delete from checklist_publication_drafts where checklist_id = p_checklist_id;

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function delete_checklist_metadata(uuid) to authenticated;

create or replace function clear_checklist_publication_package(
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

  update checklist_publication_drafts
  set package_storage_path = null,
      package_generated_at = null,
      stage = 'metadata',
      updated_at = now()
  where checklist_id = p_checklist_id;

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function clear_checklist_publication_package(uuid) to authenticated;
