-- Security hardening: every SECURITY DEFINER function in `public` must pin
-- search_path, or it resolves unqualified object references using the
-- caller's search_path (the standard Postgres SECURITY DEFINER
-- privilege-escalation vector). The trigger functions added in earlier
-- migrations (handle_new_user, notify_*, log_*, role_rank, auth_has_role,
-- auth_is_member, sync_taxonomy_status_from_conflicts) already set this; the
-- client-callable RPCs added since (create_checklist_with_species,
-- add_species_to_checklist, invite_collaborator_to_checklist,
-- update_collaborator_role, remove_collaborator_from_checklist,
-- resolve_authority_conflict, resolve_species_taxonomy, cast_conflict_vote,
-- cast_review_vote, merge_species) never did. Patch every gap dynamically
-- rather than re-deriving each function's exact signature by hand, so this
-- also covers any SECURITY DEFINER function added later without the guard.

do $$
declare
  r record;
begin
  for r in
    select p.oid, p.proname, n.nspname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public',
      r.nspname, r.proname, r.args
    );
  end loop;
end $$;
