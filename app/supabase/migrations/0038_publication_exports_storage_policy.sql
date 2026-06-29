-- The original `publication_exports_write_owner` policy (0001_init.sql) only
-- covered INSERT and only for the checklist *owner*, not editors — every
-- other write-gated table/bucket in this app (checklist_metadata,
-- checklist_publication_drafts, checklist-imports) uses 'editor' as the
-- write threshold. That mismatch is what produced "new row violates row
-- level security policy" for editor-role collaborators generating a
-- package, and it would have failed again on *re*-generation regardless of
-- role: `supabase.storage.upload(..., { upsert: true })` issues an UPDATE
-- once the object already exists, and no UPDATE policy existed at all.

drop policy if exists "publication_exports_write_owner" on storage.objects;

create policy "publication_exports_write_editor" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'publication-exports'
    and auth_has_role((storage.foldername(name))[1]::uuid, 'editor')
  )
  with check (
    bucket_id = 'publication-exports'
    and auth_has_role((storage.foldername(name))[1]::uuid, 'editor')
  );
