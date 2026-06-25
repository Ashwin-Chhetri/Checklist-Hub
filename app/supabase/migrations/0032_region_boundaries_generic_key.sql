-- Generalizes region_boundaries from a GADM-only cache (keyed by gadm_id) to
-- a generic boundary cache keyed by (source, cache_key) — needed because
-- boundaries are now also fetched from Nominatim/OSM for regions that have
-- no GADM geometry (anything that doesn't resolve to a level-2 GADM GID,
-- e.g. Sikkim). Altered in place to preserve already-cached GADM rows.

alter table region_boundaries add column source text not null default 'gadm';
alter table region_boundaries add column cache_key text;

update region_boundaries set cache_key = gadm_id where cache_key is null;

alter table region_boundaries alter column cache_key set not null;
alter table region_boundaries drop constraint region_boundaries_pkey;
alter table region_boundaries alter column gadm_id drop not null;
alter table region_boundaries add primary key (source, cache_key);

create or replace function upsert_region_boundary(
  p_source    text,
  p_cache_key text,
  p_name      text,
  p_geometry  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into region_boundaries (source, cache_key, gadm_id, name, geometry, fetched_at)
  values (p_source, p_cache_key, case when p_source = 'gadm' then p_cache_key else null end, p_name, p_geometry, now())
  on conflict (source, cache_key) do update
    set name = excluded.name,
        geometry = excluded.geometry,
        fetched_at = excluded.fetched_at;
end;
$func$;

drop function if exists upsert_region_boundary(text, text, jsonb);

grant execute on function upsert_region_boundary(text, text, text, jsonb) to authenticated;
