-- Publish module, IPT handoff step 4 ("Publish" instructions) gains a
-- "Submitted for Review" action: the user has done the real-world IPT
-- steps (logged in, created the resource, imported the package, clicked
-- Publish + Register on their IPT) but doesn't have the dataset's GBIF URL
-- yet — GBIF's crawler can take a while to pick up a freshly-registered
-- resource. Until that URL is pasted back in step 5 and resolved
-- (gbif_dataset_uuid set), the checklist isn't "published" — it's
-- externally submitted and waiting, which is a distinct state from
-- draft/validating (still being worked on in ChecklistHub).
--
-- The 'reviewing' value in checklist_status has existed since
-- 0001_init.sql but is never written or branched on anywhere in the app
-- (confirmed by searching every migration and src/ for the literal
-- 'reviewing') — reusing it here for this purpose avoids an
-- ALTER TYPE ... ADD VALUE migration.

alter table checklist_metadata
  add column ipt_submitted_at timestamptz;

create or replace function mark_checklist_submitted_for_review(p_checklist_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to update this checklist.' using errcode = '42501';
  end if;

  update checklist_metadata set ipt_submitted_at = now(), updated_at = now()
  where checklist_id = p_checklist_id;

  update checklists set status = 'reviewing' where id = p_checklist_id;

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function mark_checklist_submitted_for_review(uuid) to authenticated;
