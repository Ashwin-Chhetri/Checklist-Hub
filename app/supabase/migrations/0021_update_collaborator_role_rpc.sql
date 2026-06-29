-- Lets an editor or owner change an existing collaborator's role from the
-- Share dialog. Direct table writes are restricted to owners by the
-- "collaborators_update_owner" RLS policy (0001_init.sql), so this RPC is a
-- security-definer escape hatch that re-checks 'editor'-or-above explicitly,
-- mirroring the pattern used by invite_collaborator_to_checklist.

create function update_collaborator_role(
  p_checklist_id uuid,
  p_user_id      uuid,
  p_role         collaborator_role
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid      uuid;
  v_owner_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Editor access required.' using errcode = '42501';
  end if;

  if p_role = 'owner' then
    raise exception 'Use checklist transfer to change ownership.' using errcode = '22023';
  end if;

  select owner_id into v_owner_id from checklists where id = p_checklist_id;
  if v_owner_id = p_user_id then
    raise exception 'Cannot change the owner''s role.' using errcode = '42501';
  end if;

  update checklist_collaborators
  set role = p_role
  where checklist_id = p_checklist_id and user_id = p_user_id;

  if not found then
    raise exception 'Collaborator not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'role', p_role);
end;
$func$;

grant execute on function update_collaborator_role(uuid, uuid, collaborator_role) to authenticated;
