-- Workbench-supporting normalized tables + atomic checklist creation RPC.
-- Additive only: does not modify any table/column from 0001-0004.

-- ============================================================
-- Enums
-- ============================================================

create type invite_status as enum ('pending', 'accepted', 'declined', 'expired');

-- ============================================================
-- Tables
-- ============================================================

-- evidence_sources: per-species per-source aggregate counts (feeds the
-- "source tags" with occurrence/publication counts in the Evidence panel)
create table evidence_sources (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  source text not null check (source in ('gbif','ebird','inaturalist','literature','legacy')),
  occurrence_count int not null default 0,
  publication_count int not null default 0,
  last_updated timestamptz,
  created_at timestamptz not null default now(),
  unique (species_id, source)
);
create index evidence_sources_species_idx on evidence_sources (species_id);

-- external_db_records: external DB record links per source
create table external_db_records (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  source text not null check (source in ('gbif','ebird','inaturalist','literature','legacy')),
  external_id text not null,
  record_count int not null default 0,
  last_updated timestamptz,
  created_at timestamptz not null default now(),
  unique (species_id, source, external_id)
);
create index external_db_records_species_idx on external_db_records (species_id);

-- publications: literature evidence (title, authors, year, doi, link)
create table publications (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  title text not null,
  authors text[],
  year int,
  doi text,
  link text,
  created_at timestamptz not null default now()
);
create index publications_species_idx on publications (species_id);

-- historical_mentions: year/source/note timeline entries
create table historical_mentions (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  year int,
  source text,
  note text,
  created_at timestamptz not null default now()
);
create index historical_mentions_species_idx on historical_mentions (species_id);

-- taxonomy_conflicts: "Clements 2023 says X vs IOC 14.1 says Y" cards
create table taxonomy_conflicts (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  authority text not null,
  suggested_name text not null,
  status text not null default 'found' check (status in ('found','under_review','resolved')),
  created_at timestamptz not null default now()
);
create index taxonomy_conflicts_species_idx on taxonomy_conflicts (species_id);

-- taxonomy_votes: per-collaborator AGREE/DISAGREE on a conflict
create table taxonomy_votes (
  id uuid primary key default gen_random_uuid(),
  conflict_id uuid not null references taxonomy_conflicts(id) on delete cascade,
  voter_id uuid not null references profiles(id) on delete cascade,
  decision review_decision not null check (decision in ('agree','disagree')),
  created_at timestamptz not null default now(),
  unique (conflict_id, voter_id)
);
create index taxonomy_votes_conflict_idx on taxonomy_votes (conflict_id);

-- taxonomy_synonyms: synonym timeline (year, event, name)
create table taxonomy_synonyms (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  year int,
  event_type text not null,
  name text not null,
  authority text,
  created_at timestamptz not null default now()
);
create index taxonomy_synonyms_species_idx on taxonomy_synonyms (species_id);

-- checklist_invites: collaborator email invites (including to non-members)
create table checklist_invites (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  email text not null,
  note text,
  role collaborator_role not null default 'viewer',
  invited_by uuid not null references profiles(id),
  status invite_status not null default 'pending',
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (checklist_id, email)
);
create index checklist_invites_checklist_idx on checklist_invites (checklist_id);
create index checklist_invites_email_idx on checklist_invites (email);
create unique index checklist_invites_token_idx on checklist_invites (token);

-- ============================================================
-- RLS
-- ============================================================

alter table evidence_sources enable row level security;
alter table external_db_records enable row level security;
alter table publications enable row level security;
alter table historical_mentions enable row level security;
alter table taxonomy_conflicts enable row level security;
alter table taxonomy_votes enable row level security;
alter table taxonomy_synonyms enable row level security;
alter table checklist_invites enable row level security;

-- evidence_sources: members can read; editors can write
create policy "evidence_sources_select_members" on evidence_sources
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = evidence_sources.species_id))
  );
create policy "evidence_sources_write_editor" on evidence_sources
  for all to authenticated using (
    auth_has_role((select checklist_id from species where species.id = evidence_sources.species_id), 'editor')
  ) with check (
    auth_has_role((select checklist_id from species where species.id = evidence_sources.species_id), 'editor')
  );

-- external_db_records: members can read; editors can write
create policy "external_db_records_select_members" on external_db_records
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = external_db_records.species_id))
  );
create policy "external_db_records_write_editor" on external_db_records
  for all to authenticated using (
    auth_has_role((select checklist_id from species where species.id = external_db_records.species_id), 'editor')
  ) with check (
    auth_has_role((select checklist_id from species where species.id = external_db_records.species_id), 'editor')
  );

-- publications: members can read; editors can write
create policy "publications_select_members" on publications
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = publications.species_id))
  );
create policy "publications_write_editor" on publications
  for all to authenticated using (
    auth_has_role((select checklist_id from species where species.id = publications.species_id), 'editor')
  ) with check (
    auth_has_role((select checklist_id from species where species.id = publications.species_id), 'editor')
  );

-- historical_mentions: members can read; editors can write
create policy "historical_mentions_select_members" on historical_mentions
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = historical_mentions.species_id))
  );
create policy "historical_mentions_write_editor" on historical_mentions
  for all to authenticated using (
    auth_has_role((select checklist_id from species where species.id = historical_mentions.species_id), 'editor')
  ) with check (
    auth_has_role((select checklist_id from species where species.id = historical_mentions.species_id), 'editor')
  );

-- taxonomy_conflicts: members can read; editors can write
create policy "taxonomy_conflicts_select_members" on taxonomy_conflicts
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = taxonomy_conflicts.species_id))
  );
create policy "taxonomy_conflicts_write_editor" on taxonomy_conflicts
  for all to authenticated using (
    auth_has_role((select checklist_id from species where species.id = taxonomy_conflicts.species_id), 'editor')
  ) with check (
    auth_has_role((select checklist_id from species where species.id = taxonomy_conflicts.species_id), 'editor')
  );

-- taxonomy_synonyms: members can read; editors can write
create policy "taxonomy_synonyms_select_members" on taxonomy_synonyms
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = taxonomy_synonyms.species_id))
  );
create policy "taxonomy_synonyms_write_editor" on taxonomy_synonyms
  for all to authenticated using (
    auth_has_role((select checklist_id from species where species.id = taxonomy_synonyms.species_id), 'editor')
  ) with check (
    auth_has_role((select checklist_id from species where species.id = taxonomy_synonyms.species_id), 'editor')
  );

-- taxonomy_votes: members can read all votes; any commenter+ can cast/update their own vote
create policy "taxonomy_votes_select_members" on taxonomy_votes
  for select to authenticated using (
    auth_is_member((select checklist_id from species
      join taxonomy_conflicts on taxonomy_conflicts.species_id = species.id
      where taxonomy_conflicts.id = taxonomy_votes.conflict_id))
  );
create policy "taxonomy_votes_insert_own" on taxonomy_votes
  for insert to authenticated with check (
    voter_id = auth.uid()
    and auth_has_role((select checklist_id from species
      join taxonomy_conflicts on taxonomy_conflicts.species_id = species.id
      where taxonomy_conflicts.id = taxonomy_votes.conflict_id), 'commenter')
  );
create policy "taxonomy_votes_update_own" on taxonomy_votes
  for update to authenticated using (voter_id = auth.uid());

-- checklist_invites: owners manage; invited user (matched by email on their
-- own profile) can read/update their own invite to accept/decline
create policy "checklist_invites_select_owner_or_invitee" on checklist_invites
  for select to authenticated using (
    auth_has_role(checklist_id, 'owner')
    or email = (select email from profiles where id = auth.uid())
  );
create policy "checklist_invites_insert_owner" on checklist_invites
  for insert to authenticated with check (auth_has_role(checklist_id, 'owner'));
create policy "checklist_invites_update_owner_or_invitee" on checklist_invites
  for update to authenticated using (
    auth_has_role(checklist_id, 'owner')
    or email = (select email from profiles where id = auth.uid())
  );
create policy "checklist_invites_delete_owner" on checklist_invites
  for delete to authenticated using (auth_has_role(checklist_id, 'owner'));

-- ============================================================
-- Atomic checklist creation RPC
-- ============================================================

-- Atomically creates a checklist + species + normalized child rows +
-- collaborator invites in one transaction. Runs as the calling user
-- (security invoker) so checklists_insert_self RLS (owner_id = auth.uid())
-- and species_insert_editor RLS (auth_has_role(checklist_id, 'editor'),
-- satisfied immediately via get_user_role -> owner_id) pass naturally.
create function create_checklist_with_species(
  p_checklist jsonb,      -- {title, region_name, region_country, region_state, region_district, region_gadm_id, taxonomic_scope, status}
  p_species jsonb,        -- array of species row objects
  p_invites jsonb         -- array of {email, note, role}
) returns uuid
language plpgsql
security invoker
set search_path = public
as $func$
declare
  v_checklist_id uuid;
  v_species jsonb;
  v_species_id uuid;
  v_item jsonb;
begin
  insert into checklists (title, region_name, region_country, region_state,
    region_district, region_gadm_id, taxonomic_scope, status, owner_id)
  select p_checklist->>'title', p_checklist->>'region_name', p_checklist->>'region_country',
    p_checklist->>'region_state', p_checklist->>'region_district', p_checklist->>'region_gadm_id',
    coalesce(p_checklist->'taxonomic_scope', '{}'::jsonb),
    coalesce(p_checklist->>'status', 'draft')::checklist_status, auth.uid()
  returning id into v_checklist_id;

  for v_species in select * from jsonb_array_elements(coalesce(p_species, '[]'::jsonb))
  loop
    insert into species (checklist_id, scientific_name, common_name, gbif_taxon_key,
      kingdom, phylum, class, "order", family, genus, identity, evidence, taxonomy)
    select v_checklist_id, v_species->>'scientific_name', v_species->>'common_name',
      (v_species->>'gbif_taxon_key')::bigint,
      v_species->'classification'->>'kingdom', v_species->'classification'->>'phylum',
      v_species->'classification'->>'class', v_species->'classification'->>'order',
      v_species->'classification'->>'family', v_species->'classification'->>'genus',
      coalesce(v_species->'identity', '{}'::jsonb),
      coalesce(v_species->'evidence', '{}'::jsonb),
      coalesce(v_species->'taxonomy', '{}'::jsonb)
    returning id into v_species_id;

    if jsonb_array_length(coalesce(v_species->'evidence_sources', '[]'::jsonb)) > 0 then
      insert into evidence_sources (species_id, source, occurrence_count, publication_count, last_updated)
      select v_species_id, item->>'source',
        coalesce((item->>'occurrence_count')::int, 0),
        coalesce((item->>'publication_count')::int, 0),
        (item->>'last_updated')::timestamptz
      from jsonb_array_elements(v_species->'evidence_sources') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'external_db_records', '[]'::jsonb)) > 0 then
      insert into external_db_records (species_id, source, external_id, record_count, last_updated)
      select v_species_id, item->>'source', item->>'external_id',
        coalesce((item->>'record_count')::int, 0),
        (item->>'last_updated')::timestamptz
      from jsonb_array_elements(v_species->'external_db_records') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'publications', '[]'::jsonb)) > 0 then
      insert into publications (species_id, title, authors, year, doi, link)
      select v_species_id, item->>'title',
        case when item->'authors' is not null
          then (select array_agg(a) from jsonb_array_elements_text(item->'authors') a)
          else null end,
        (item->>'year')::int, item->>'doi', item->>'link'
      from jsonb_array_elements(v_species->'publications') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'historical_mentions', '[]'::jsonb)) > 0 then
      insert into historical_mentions (species_id, year, source, note)
      select v_species_id, (item->>'year')::int, item->>'source', item->>'note'
      from jsonb_array_elements(v_species->'historical_mentions') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'taxonomy_conflicts', '[]'::jsonb)) > 0 then
      insert into taxonomy_conflicts (species_id, authority, suggested_name, status)
      select v_species_id, item->>'authority', item->>'suggested_name',
        coalesce(item->>'status', 'found')
      from jsonb_array_elements(v_species->'taxonomy_conflicts') item;
    end if;

    if jsonb_array_length(coalesce(v_species->'taxonomy_synonyms', '[]'::jsonb)) > 0 then
      insert into taxonomy_synonyms (species_id, year, event_type, name, authority)
      select v_species_id, (item->>'year')::int, item->>'event_type', item->>'name', item->>'authority'
      from jsonb_array_elements(v_species->'taxonomy_synonyms') item;
    end if;
  end loop;

  -- checklist_collaborators for invites matching an existing profile by email
  insert into checklist_collaborators (checklist_id, user_id, role, invited_by)
  select v_checklist_id, p.id, coalesce((inv->>'role')::collaborator_role, 'viewer'), auth.uid()
  from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) inv
  join profiles p on p.email = inv->>'email';

  -- checklist_invites for ALL invites (status reflects whether matched to an
  -- existing profile, for audit/notification purposes)
  insert into checklist_invites (checklist_id, email, note, role, invited_by, status)
  select v_checklist_id, inv->>'email', inv->>'note',
    coalesce((inv->>'role')::collaborator_role, 'viewer'), auth.uid(),
    case when exists (select 1 from profiles where email = inv->>'email') then 'accepted'::invite_status else 'pending'::invite_status end
  from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) inv;

  return v_checklist_id;
end;
$func$;
