-- ChecklistHub V1 - core schema, RLS policies, and storage buckets
-- See checklistHub_architecture.md and the implementation plan for context.

-- ============================================================
-- Enums
-- ============================================================

create type collaborator_role as enum ('owner', 'editor', 'reviewer', 'commenter', 'viewer');
create type checklist_status as enum ('draft', 'importing', 'validating', 'reviewing', 'published', 'archived');
create type evidence_quality as enum ('high', 'medium', 'low', 'insufficient');
create type taxonomy_status as enum ('clean', 'outdated', 'conflict');
create type review_status as enum ('not_reviewed', 'under_review', 'reviewed', 'accepted', 'rejected');
create type import_status as enum ('pending', 'processing', 'validated', 'failed');
create type import_issue_type as enum ('duplicate_id', 'extralimital', 'taxonomic_conflict', 'synonym', 'geospatial');
create type review_decision as enum ('accept', 'reject', 'agree', 'disagree');

-- ============================================================
-- Core tables
-- ============================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  email text,
  created_at timestamptz not null default now()
);

create table checklists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  region_name text,
  region_country text,
  region_state text,
  region_district text,
  region_gadm_id text,
  taxonomic_scope jsonb not null default '{}'::jsonb,
  status checklist_status not null default 'draft',
  owner_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table checklist_collaborators (
  checklist_id uuid not null references checklists(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role collaborator_role not null default 'viewer',
  invited_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (checklist_id, user_id)
);

create table species (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  scientific_name text not null,
  common_name text,
  gbif_taxon_key bigint,
  first_record_year int,
  kingdom text,
  phylum text,
  class text,
  "order" text,
  family text,
  genus text,
  evidence_quality evidence_quality not null default 'insufficient',
  taxonomy_status taxonomy_status not null default 'clean',
  review_status review_status not null default 'not_reviewed',
  identity jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  taxonomy jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  publication jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table species_comments (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  parent_comment_id uuid references species_comments(id) on delete cascade,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table species_reviews (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  reviewer_id uuid not null references profiles(id),
  decision review_decision not null,
  target jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

create table checklist_imports (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  file_path text not null,
  status import_status not null default 'pending',
  summary jsonb not null default '{}'::jsonb,
  error_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table import_issues (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references checklist_imports(id) on delete cascade,
  species_id uuid references species(id) on delete cascade,
  issue_type import_issue_type not null,
  description text,
  payload jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  checklist_id uuid references checklists(id) on delete cascade,
  species_id uuid references species(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  actor_id uuid references profiles(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- TTL cache for external API responses (GBIF etc.)
create table external_api_cache (
  cache_key text primary key,
  source text not null,
  response jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================

create index species_checklist_review_idx on species (checklist_id, review_status);
create index species_checklist_taxonomy_idx on species (checklist_id, taxonomy_status);
create index species_checklist_evidence_idx on species (checklist_id, evidence_quality);
create index species_taxonomy_gin_idx on species using gin (taxonomy);
create index species_evidence_gin_idx on species using gin (evidence);
create index species_comments_species_created_idx on species_comments (species_id, created_at);
create index checklist_collaborators_user_idx on checklist_collaborators (user_id);
create index notifications_user_idx on notifications (user_id, read);
create index activity_log_checklist_idx on activity_log (checklist_id, created_at);

-- ============================================================
-- profiles auto-creation trigger
-- ============================================================

create function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- Role helper functions
-- ============================================================

-- Returns the caller's role on a checklist, or null if not a member.
-- Owners are resolved from checklists.owner_id (implicit 'owner' role)
-- in addition to any explicit checklist_collaborators row.
create function get_user_role(p_checklist_id uuid, p_user_id uuid)
returns collaborator_role
language sql
stable
security definer set search_path = public
as $$
  select case
    when exists (
      select 1 from checklists
      where id = p_checklist_id and owner_id = p_user_id
    ) then 'owner'::collaborator_role
    else (
      select role from checklist_collaborators
      where checklist_id = p_checklist_id and user_id = p_user_id
    )
  end;
$$;

-- Role rank: owner > editor > reviewer > commenter > viewer
create function role_rank(p_role collaborator_role)
returns int
language sql
immutable
as $$
  select case p_role
    when 'owner' then 5
    when 'editor' then 4
    when 'reviewer' then 3
    when 'commenter' then 2
    when 'viewer' then 1
    else 0
  end;
$$;

-- True if the calling user has at least p_min_role on p_checklist_id.
create function auth_has_role(p_checklist_id uuid, p_min_role collaborator_role)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(role_rank(get_user_role(p_checklist_id, auth.uid())), 0) >= role_rank(p_min_role);
$$;

-- True if the calling user is any kind of member of p_checklist_id.
create function auth_is_member(p_checklist_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select get_user_role(p_checklist_id, auth.uid()) is not null;
$$;

-- ============================================================
-- RLS
-- ============================================================

alter table profiles enable row level security;
alter table checklists enable row level security;
alter table checklist_collaborators enable row level security;
alter table species enable row level security;
alter table species_comments enable row level security;
alter table species_reviews enable row level security;
alter table checklist_imports enable row level security;
alter table import_issues enable row level security;
alter table notifications enable row level security;
alter table activity_log enable row level security;
alter table external_api_cache enable row level security;

-- profiles: anyone authenticated can read profiles (needed for avatars/names);
-- users can only update their own.
create policy "profiles_select_authenticated" on profiles
  for select to authenticated using (true);

create policy "profiles_update_own" on profiles
  for update to authenticated using (id = auth.uid());

-- checklists
create policy "checklists_select_members" on checklists
  for select to authenticated using (auth_is_member(id));

create policy "checklists_insert_self" on checklists
  for insert to authenticated with check (owner_id = auth.uid());

create policy "checklists_update_owner" on checklists
  for update to authenticated using (auth_has_role(id, 'owner'));

create policy "checklists_delete_owner" on checklists
  for delete to authenticated using (auth_has_role(id, 'owner'));

-- checklist_collaborators
create policy "collaborators_select_members" on checklist_collaborators
  for select to authenticated using (auth_is_member(checklist_id));

create policy "collaborators_insert_owner" on checklist_collaborators
  for insert to authenticated with check (auth_has_role(checklist_id, 'owner'));

create policy "collaborators_update_owner" on checklist_collaborators
  for update to authenticated using (auth_has_role(checklist_id, 'owner'));

create policy "collaborators_delete_owner" on checklist_collaborators
  for delete to authenticated using (auth_has_role(checklist_id, 'owner'));

-- species
create policy "species_select_members" on species
  for select to authenticated using (auth_is_member(checklist_id));

create policy "species_insert_editor" on species
  for insert to authenticated with check (auth_has_role(checklist_id, 'editor'));

create policy "species_update_editor_or_reviewer" on species
  for update to authenticated using (auth_has_role(checklist_id, 'reviewer'));

create policy "species_delete_editor" on species
  for delete to authenticated using (auth_has_role(checklist_id, 'editor'));

-- species_comments
create policy "comments_select_members" on species_comments
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = species_comments.species_id))
  );

create policy "comments_insert_commenter" on species_comments
  for insert to authenticated with check (
    author_id = auth.uid()
    and auth_has_role((select checklist_id from species where species.id = species_comments.species_id), 'commenter')
  );

create policy "comments_update_own_or_owner" on species_comments
  for update to authenticated using (
    author_id = auth.uid()
    or auth_has_role((select checklist_id from species where species.id = species_comments.species_id), 'owner')
  );

create policy "comments_delete_own_or_owner" on species_comments
  for delete to authenticated using (
    author_id = auth.uid()
    or auth_has_role((select checklist_id from species where species.id = species_comments.species_id), 'owner')
  );

-- species_reviews
create policy "reviews_select_members" on species_reviews
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = species_reviews.species_id))
  );

create policy "reviews_insert_reviewer" on species_reviews
  for insert to authenticated with check (
    reviewer_id = auth.uid()
    and auth_has_role((select checklist_id from species where species.id = species_reviews.species_id), 'reviewer')
  );

-- checklist_imports / import_issues: editor and owner only
create policy "imports_select_editor" on checklist_imports
  for select to authenticated using (auth_has_role(checklist_id, 'editor'));

create policy "imports_insert_editor" on checklist_imports
  for insert to authenticated with check (auth_has_role(checklist_id, 'editor'));

create policy "imports_update_editor" on checklist_imports
  for update to authenticated using (auth_has_role(checklist_id, 'editor'));

create policy "import_issues_select_editor" on import_issues
  for select to authenticated using (
    auth_has_role((select checklist_id from checklist_imports where checklist_imports.id = import_issues.import_id), 'editor')
  );

create policy "import_issues_insert_editor" on import_issues
  for insert to authenticated with check (
    auth_has_role((select checklist_id from checklist_imports where checklist_imports.id = import_issues.import_id), 'editor')
  );

create policy "import_issues_update_editor" on import_issues
  for update to authenticated using (
    auth_has_role((select checklist_id from checklist_imports where checklist_imports.id = import_issues.import_id), 'editor')
  );

-- notifications: only the owning user
create policy "notifications_select_own" on notifications
  for select to authenticated using (user_id = auth.uid());

create policy "notifications_update_own" on notifications
  for update to authenticated using (user_id = auth.uid());

-- activity_log: members can read; inserts via service role / triggers only (no insert policy for authenticated)
create policy "activity_log_select_members" on activity_log
  for select to authenticated using (auth_is_member(checklist_id));

-- external_api_cache: shared read cache for any authenticated user, writes via service role only
create policy "external_api_cache_select_authenticated" on external_api_cache
  for select to authenticated using (true);

-- ============================================================
-- Storage buckets
-- ============================================================

insert into storage.buckets (id, name, public)
values
  ('checklist-imports', 'checklist-imports', false),
  ('evidence-attachments', 'evidence-attachments', false),
  ('publication-exports', 'publication-exports', false)
on conflict (id) do nothing;

-- Path convention: <checklist_id>/... ; first path segment identifies the checklist.
create policy "checklist_imports_rw_editor" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'checklist-imports'
    and auth_has_role((storage.foldername(name))[1]::uuid, 'editor')
  )
  with check (
    bucket_id = 'checklist-imports'
    and auth_has_role((storage.foldername(name))[1]::uuid, 'editor')
  );

create policy "evidence_attachments_rw_commenter" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'evidence-attachments'
    and auth_is_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'evidence-attachments'
    and auth_has_role((storage.foldername(name))[1]::uuid, 'commenter')
  );

create policy "publication_exports_read_members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'publication-exports'
    and auth_is_member((storage.foldername(name))[1]::uuid)
  );

create policy "publication_exports_write_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'publication-exports'
    and auth_has_role((storage.foldername(name))[1]::uuid, 'owner')
  );
