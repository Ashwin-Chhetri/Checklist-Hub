-- Adds checklist_collaborators/checklist_invites to the realtime publication
-- so the Share dialog (and any other open tab) can react live when an
-- invited user creates a profile and gets bridged into checklist_collaborators
-- (see 0019_fix_invite_email_case.sql), instead of requiring a manual reopen.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'checklist_collaborators'
  ) then
    alter publication supabase_realtime add table checklist_collaborators;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'checklist_invites'
  ) then
    alter publication supabase_realtime add table checklist_invites;
  end if;
end $$;
