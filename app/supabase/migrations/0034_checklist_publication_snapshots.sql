-- Publish module, step 3: append-only history of each publish event, so the
-- publish metadata page's "Historical Comparison" section can diff the
-- current accepted species set against the last time this checklist was
-- published instead of fabricating numbers. One row per publish (never
-- updated/deleted). `record_checklist_publication` does the status flip +
-- snapshot insert as a single security-definer RPC, same shape as
-- `upsert_checklist_metadata` (0033).

create table checklist_publication_snapshots (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references checklists(id) on delete cascade,
  species_count int not null default 0,
  family_count int not null default 0,
  genus_count int not null default 0,
  order_count int not null default 0,
  species_ids uuid[] not null default '{}',
  published_at timestamptz not null default now(),
  published_by uuid references profiles(id)
);

create index checklist_publication_snapshots_checklist_idx
  on checklist_publication_snapshots (checklist_id, published_at desc);

alter table checklist_publication_snapshots enable row level security;

create policy "checklist_publication_snapshots_select_members" on checklist_publication_snapshots
  for select to authenticated using (auth_is_member(checklist_id));

-- Flips the checklist to "published" and records a snapshot of the current
-- accepted species set in one transaction, so the app server stays a thin
-- single-RPC-call wrapper instead of chaining an update + a separate insert.
create or replace function record_checklist_publication(
  p_checklist_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid uuid;
  v_species_count int;
  v_family_count int;
  v_genus_count int;
  v_order_count int;
  v_species_ids uuid[];
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not auth_has_role(p_checklist_id, 'editor') then
    raise exception 'Not authorized to publish this checklist.' using errcode = '42501';
  end if;

  select
    count(*),
    count(distinct family) filter (where family is not null),
    count(distinct genus) filter (where genus is not null),
    count(distinct "order") filter (where "order" is not null),
    coalesce(array_agg(id), '{}')
  into v_species_count, v_family_count, v_genus_count, v_order_count, v_species_ids
  from species
  where checklist_id = p_checklist_id
    and review_status = 'accepted'
    and is_active = true;

  update checklists set status = 'published' where id = p_checklist_id;

  insert into checklist_publication_snapshots (
    checklist_id, species_count, family_count, genus_count, order_count, species_ids, published_by
  ) values (
    p_checklist_id, v_species_count, v_family_count, v_genus_count, v_order_count, v_species_ids, v_uid
  );

  return jsonb_build_object('ok', true);
end;
$func$;

grant execute on function record_checklist_publication(uuid) to authenticated;
