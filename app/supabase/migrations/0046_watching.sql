-- Watching module: periodic GBIF/eBird/iNaturalist re-discovery per checklist,
-- diffed against existing species, alerting chosen collaborators when new
-- candidate species or new observations on existing species are found.
-- Additive only: does not modify any existing table/column.

-- ============================================================
-- Enums
-- ============================================================

create type watch_frequency as enum ('weekly', 'monthly');
create type watcher_run_status as enum ('running', 'completed', 'failed');
create type watcher_candidate_status as enum ('pending', 'added', 'dismissed');

-- ============================================================
-- Tables
-- ============================================================

-- watchers: one watch subscription per checklist.
create table watchers (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  frequency watch_frequency not null default 'weekly',
  is_active boolean not null default true,
  -- "from the date of creation" — set once from the checklist's created_at
  -- when the watcher is first created, never recomputed afterward.
  started_at timestamptz not null,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (checklist_id)
);

-- watcher_subscribers: which collaborators get alerted when a run finds something.
create table watcher_subscribers (
  watcher_id uuid not null references watchers(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (watcher_id, user_id)
);

-- watcher_runs: append-only run history (one row per ETL execution).
create table watcher_runs (
  id uuid primary key default gen_random_uuid(),
  watcher_id uuid not null references watchers(id) on delete cascade,
  checklist_id uuid not null references checklists(id) on delete cascade,
  status watcher_run_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  new_species_count int not null default 0,
  updated_species_count int not null default 0,
  -- Per-source status/counts, same shape as discovery's SourceSummary[].
  source_summary jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

-- watcher_candidate_species: temporary staging of species found by a run that
-- are not yet in the checklist (resolved by accepted GBIF taxon key, so a
-- synonym of an existing species never lands here). Never auto-merged into
-- `species` — only via the apply_watcher_run RPC after explicit review.
create table watcher_candidate_species (
  id uuid primary key default gen_random_uuid(),
  watcher_run_id uuid not null references watcher_runs(id) on delete cascade,
  checklist_id uuid not null references checklists(id) on delete cascade,
  scientific_name text not null,
  common_name text,
  gbif_taxon_key bigint,
  family text,
  classification jsonb not null default '{}'::jsonb,
  sources text[] not null default '{}',
  occurrence_counts jsonb not null default '{}'::jsonb,
  total_occurrences int not null default 0,
  status watcher_candidate_status not null default 'pending',
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- watcher_observation_updates: occurrence-count deltas found for species that
-- already exist in the checklist.
create table watcher_observation_updates (
  id uuid primary key default gen_random_uuid(),
  watcher_run_id uuid not null references watcher_runs(id) on delete cascade,
  species_id uuid not null references species(id) on delete cascade,
  previous_counts jsonb not null default '{}'::jsonb,
  new_counts jsonb not null default '{}'::jsonb,
  delta int not null default 0,
  applied boolean not null default false,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================

create index watchers_checklist_idx on watchers (checklist_id);
create index watchers_due_idx on watchers (next_run_at) where is_active;
create index watcher_subscribers_user_idx on watcher_subscribers (user_id);
create index watcher_runs_watcher_idx on watcher_runs (watcher_id, created_at desc);
create index watcher_runs_checklist_idx on watcher_runs (checklist_id, created_at desc);
create index watcher_candidate_species_run_idx on watcher_candidate_species (watcher_run_id);
create index watcher_candidate_species_checklist_pending_idx
  on watcher_candidate_species (checklist_id) where status = 'pending';
create index watcher_observation_updates_run_idx on watcher_observation_updates (watcher_run_id);
create index watcher_observation_updates_species_idx on watcher_observation_updates (species_id);
create index watcher_observation_updates_unapplied_idx
  on watcher_observation_updates (species_id) where not applied;

-- ============================================================
-- RLS
-- ============================================================

alter table watchers enable row level security;
alter table watcher_subscribers enable row level security;
alter table watcher_runs enable row level security;
alter table watcher_candidate_species enable row level security;
alter table watcher_observation_updates enable row level security;

-- watchers: members can read; editors+ can create/update/deactivate.
create policy "watchers_select_members" on watchers
  for select to authenticated using (auth_is_member(checklist_id));

create policy "watchers_insert_editor" on watchers
  for insert to authenticated with check (auth_has_role(checklist_id, 'editor'));

create policy "watchers_update_editor" on watchers
  for update to authenticated using (auth_has_role(checklist_id, 'editor'));

create policy "watchers_delete_editor" on watchers
  for delete to authenticated using (auth_has_role(checklist_id, 'editor'));

-- watcher_subscribers: members can read; editors+ manage the subscriber list.
create policy "watcher_subscribers_select_members" on watcher_subscribers
  for select to authenticated using (
    auth_is_member((select checklist_id from watchers where watchers.id = watcher_subscribers.watcher_id))
  );

create policy "watcher_subscribers_write_editor" on watcher_subscribers
  for all to authenticated using (
    auth_has_role((select checklist_id from watchers where watchers.id = watcher_subscribers.watcher_id), 'editor')
  ) with check (
    auth_has_role((select checklist_id from watchers where watchers.id = watcher_subscribers.watcher_id), 'editor')
  );

-- watcher_runs / watcher_candidate_species / watcher_observation_updates:
-- members can read; writes happen only via the cron route's service-role
-- client and the apply_watcher_run RPC (no insert policy for authenticated),
-- same pattern as activity_log.
create policy "watcher_runs_select_members" on watcher_runs
  for select to authenticated using (auth_is_member(checklist_id));

create policy "watcher_candidate_species_select_members" on watcher_candidate_species
  for select to authenticated using (auth_is_member(checklist_id));

create policy "watcher_observation_updates_select_members" on watcher_observation_updates
  for select to authenticated using (
    auth_is_member((select checklist_id from species where species.id = watcher_observation_updates.species_id))
  );

-- ============================================================
-- apply_watcher_run RPC — applies a reviewed run's accepted candidates +
-- observation updates in one transaction (the dialog's "Updated" CTA).
-- ============================================================

create function apply_watcher_run(
  p_run_id uuid,
  p_accepted_candidate_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = public
as $func$
declare
  v_checklist_id uuid;
  v_candidate jsonb;
  v_species_id uuid;
begin
  select checklist_id into v_checklist_id from watcher_runs where id = p_run_id;
  if v_checklist_id is null then
    raise exception 'watcher run not found';
  end if;
  if not auth_has_role(v_checklist_id, 'editor') then
    raise exception 'insufficient role to apply watcher run';
  end if;

  -- Insert accepted candidates into species, mirroring create_checklist_with_species's
  -- per-species insert shape.
  for v_candidate in
    select to_jsonb(c) from watcher_candidate_species c
    where c.watcher_run_id = p_run_id
      and c.id = any(p_accepted_candidate_ids)
      and c.status = 'pending'
  loop
    insert into species (checklist_id, scientific_name, common_name, gbif_taxon_key,
      kingdom, phylum, class, "order", family, genus, identity, evidence, taxonomy)
    select v_checklist_id, v_candidate->>'scientific_name', v_candidate->>'common_name',
      (v_candidate->>'gbif_taxon_key')::bigint,
      v_candidate->'classification'->>'kingdom', v_candidate->'classification'->>'phylum',
      v_candidate->'classification'->>'class', v_candidate->'classification'->>'order',
      coalesce(v_candidate->'classification'->>'family', v_candidate->>'family'),
      v_candidate->'classification'->>'genus',
      jsonb_build_object('occurrence_count', coalesce((v_candidate->>'total_occurrences')::int, 0)),
      jsonb_build_object('occurrence_count', coalesce((v_candidate->>'total_occurrences')::int, 0)),
      '{}'::jsonb
    returning id into v_species_id;

    insert into evidence_sources (species_id, source, occurrence_count, last_updated)
    select v_species_id, key, coalesce(value::int, 0), now()
    from jsonb_each_text(coalesce(v_candidate->'occurrence_counts', '{}'::jsonb));
  end loop;

  update watcher_candidate_species
  set status = case when id = any(p_accepted_candidate_ids) then 'added' else 'dismissed' end,
    resolved_by = auth.uid(), resolved_at = now()
  where watcher_run_id = p_run_id and status = 'pending';

  -- Apply observation-count updates onto existing species' evidence_sources rows.
  update evidence_sources es
  set occurrence_count = coalesce((wou.new_counts->>es.source)::int, es.occurrence_count),
    last_updated = now()
  from watcher_observation_updates wou
  where wou.watcher_run_id = p_run_id
    and wou.species_id = es.species_id
    and not wou.applied
    and wou.new_counts ? es.source;

  update watcher_observation_updates
  set applied = true, applied_at = now()
  where watcher_run_id = p_run_id and not applied;
end;
$func$;
