-- Lets a collaborator manually add an evidence source (e.g. a literature
-- reference not picked up by automated discovery) or discard/restore one
-- they believe is falsified — without ever deleting the underlying record,
-- so the audit trail in activity_log always shows what happened and who did
-- it. Mirrors resolve_species_taxonomy (0023) and the rest of this file's
-- security-definer RPC + activity_log pattern.

create or replace function set_evidence_source(
  p_species_id     uuid,
  p_checklist_id   uuid,
  p_action         text, -- 'add' | 'discard' | 'restore'
  p_source         text, -- one of species_evidence_source.source's enum values
  p_reference_text text default null,
  p_source_link    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_uid         uuid;
  v_evidence    jsonb;
  v_sources     jsonb;
  v_match_idx   int;
  v_scientific_name text;
  v_action_name text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_action not in ('add', 'discard', 'restore') then
    raise exception 'p_action must be ''add'', ''discard'', or ''restore''.' using errcode = '22023';
  end if;

  if p_source not in ('gbif', 'ebird', 'inaturalist', 'literature', 'legacy') then
    raise exception 'p_source must be a known evidence source.' using errcode = '22023';
  end if;

  select evidence, scientific_name into v_evidence, v_scientific_name
  from species
  where id = p_species_id and checklist_id = p_checklist_id;

  if not found then
    raise exception 'Species not found.' using errcode = 'P0002';
  end if;

  v_evidence := coalesce(v_evidence, '{}'::jsonb);
  v_sources := coalesce(v_evidence->'sources', '[]'::jsonb);

  if p_action = 'add' then
    v_sources := v_sources || jsonb_build_array(
      jsonb_build_object(
        'source', p_source,
        'reference_text', p_reference_text,
        'source_link', p_source_link,
        'status', 'active',
        'manually_added', true
      )
    );
    v_action_name := 'evidence_source_added';
  else
    -- discard/restore: flip status on the matching source entry. If a
    -- checklist has more than one entry for the same source (shouldn't
    -- normally happen, but isn't enforced), only the first match is touched
    -- — same "first occurrence wins" convention used elsewhere in this app
    -- for deduping by name/key.
    select (ord - 1) into v_match_idx
    from jsonb_array_elements(v_sources) with ordinality as t(elem, ord)
    where elem->>'source' = p_source
    limit 1;

    if v_match_idx is null then
      raise exception 'No evidence source ''%'' recorded for this species.', p_source using errcode = 'P0002';
    end if;

    v_sources := jsonb_set(
      v_sources,
      array[v_match_idx::text, 'status'],
      to_jsonb(case when p_action = 'discard' then 'discarded' else 'active' end)
    );
    v_action_name := case when p_action = 'discard' then 'evidence_source_discarded' else 'evidence_source_restored' end;
  end if;

  v_evidence := v_evidence || jsonb_build_object('sources', v_sources);

  update species
  set evidence = v_evidence
  where id = p_species_id and checklist_id = p_checklist_id;

  insert into activity_log (checklist_id, actor_id, action, target_type, target_id, payload)
  values (
    p_checklist_id, v_uid, v_action_name, 'species', p_species_id,
    jsonb_build_object('scientific_name', v_scientific_name, 'source', p_source)
  );

  return jsonb_build_object('ok', true, 'action', p_action, 'source', p_source);
end;
$func$;

grant execute on function set_evidence_source(uuid, uuid, text, text, text, text) to authenticated;
