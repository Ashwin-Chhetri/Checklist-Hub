-- Need-basis cache for region boundary GeoJSON. We keep the full GADM
-- GeoPackage on the server filesystem as the offline source of truth (see
-- scripts/build-gadm.mjs, app/data/gadm.sqlite) — but it only stores raw WKB
-- bytes per district, not decoded/simplified GeoJSON for all ~47k districts
-- worldwide. Decoding + Douglas-Peucker simplification happens lazily, the
-- first time a checklist's region map is requested for a given GID, and the
-- result is cached here — so this table only ever grows with the (small) set
-- of regions actually used by real checklists, not the whole planet. This is
-- application data scoped to what checklists actually use, unlike the bulk
-- GADM/GBIF mirrors themselves (which stay off Supabase per AGENTS.md).

create table region_boundaries (
  gadm_id text primary key,
  name text,
  geometry jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table region_boundaries enable row level security;

-- Shared read cache for any authenticated user; writes go through the
-- upsert_region_boundary RPC below (security definer), same convention as
-- every other write-needs-to-bypass-RLS path in this schema (see
-- resolve_species_taxonomy, set_evidence_source).
create policy "region_boundaries_select_authenticated" on region_boundaries
  for select to authenticated using (true);

create or replace function upsert_region_boundary(
  p_gadm_id  text,
  p_name     text,
  p_geometry jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into region_boundaries (gadm_id, name, geometry, fetched_at)
  values (p_gadm_id, p_name, p_geometry, now())
  on conflict (gadm_id) do update
    set name = excluded.name,
        geometry = excluded.geometry,
        fetched_at = excluded.fetched_at;
end;
$func$;

grant execute on function upsert_region_boundary(text, text, jsonb) to authenticated;
