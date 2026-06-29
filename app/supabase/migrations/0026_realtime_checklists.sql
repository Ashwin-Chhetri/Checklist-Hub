-- Lets the checklist organizer list react live to a checklist being
-- deleted (or created/renamed) by any collaborator, instead of only the
-- deleting user's own tab reflecting it until everyone else manually
-- refreshes. RLS on checklists already scopes which rows each subscriber's
-- realtime feed includes, same as every other postgres_changes listener in
-- this app.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'checklists'
  ) then
    alter publication supabase_realtime add table checklists;
  end if;
end $$;
