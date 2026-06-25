-- Comments/decisions for the Darwin Core package review page
-- ("Review Activity & Actions" panel). Scoped to the checklist directly
-- (unlike species_comments, which is species-scoped) since this is a
-- review of the whole publication package, not any single taxon row.
-- Append-only, same as activity_log — no edit/delete, so the review trail
-- stays trustworthy.

create table checklist_publication_comments (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  decision text check (decision in ('approve', 'request_changes')),
  created_at timestamptz not null default now()
);

create index checklist_publication_comments_checklist_idx
  on checklist_publication_comments (checklist_id, created_at);

alter table checklist_publication_comments enable row level security;

create policy "checklist_publication_comments_select_members" on checklist_publication_comments
  for select to authenticated using (auth_is_member(checklist_id));

create policy "checklist_publication_comments_insert_commenter" on checklist_publication_comments
  for insert to authenticated
  with check (auth_has_role(checklist_id, 'commenter') and author_id = auth.uid());
