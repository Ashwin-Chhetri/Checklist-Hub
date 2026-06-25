-- apply_watcher_run previously only updated the evidence_sources relational
-- table on apply, which is NOT what the workbench table displays as a
-- species' "Occurrence" count (that's species.evidence.occurrence_count,
-- see SpeciesRow.tsx) — so clicking "Updated" never actually changed the
-- number shown in the table. Replace the observation-update half of the
-- function to also write species.evidence.occurrence_count (and merge the
-- per-source breakdown into species.evidence.sources[]) from the run's
-- new_total/new_counts, in addition to keeping evidence_sources in sync.

create or replace function apply_watcher_run(
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
  v_update record;
  v_evidence jsonb;
  v_sources jsonb;
  v_source_key text;
  v_source_value text;
  v_match_idx int;
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

  -- Apply each observation update onto the existing species row: the
  -- workbench-displayed total (evidence.occurrence_count), its per-source
  -- breakdown (evidence.sources[]), and the evidence_sources relational rows.
  for v_update in
    select * from watcher_observation_updates
    where watcher_run_id = p_run_id and not applied
  loop
    select evidence into v_evidence from species where id = v_update.species_id;
    v_evidence := coalesce(v_evidence, '{}'::jsonb);
    v_sources := coalesce(v_evidence->'sources', '[]'::jsonb);

    for v_source_key, v_source_value in
      select key, value from jsonb_each_text(coalesce(v_update.new_counts, '{}'::jsonb))
    loop
      select (ord - 1) into v_match_idx
      from jsonb_array_elements(v_sources) with ordinality as t(elem, ord)
      where elem->>'source' = v_source_key
      limit 1;

      if v_match_idx is not null then
        v_sources := jsonb_set(v_sources, array[v_match_idx::text, 'record_count'], to_jsonb(v_source_value::int));
      else
        v_sources := v_sources || jsonb_build_array(
          jsonb_build_object('source', v_source_key, 'record_count', v_source_value::int)
        );
      end if;
    end loop;

    v_evidence := v_evidence || jsonb_build_object('occurrence_count', v_update.new_total, 'sources', v_sources);

    update species set evidence = v_evidence where id = v_update.species_id;

    insert into evidence_sources (species_id, source, occurrence_count, last_updated)
    select v_update.species_id, key, coalesce(value::int, 0), now()
    from jsonb_each_text(coalesce(v_update.new_counts, '{}'::jsonb))
    on conflict (species_id, source) do update
      set occurrence_count = excluded.occurrence_count, last_updated = excluded.last_updated;
  end loop;

  update watcher_observation_updates
  set applied = true, applied_at = now()
  where watcher_run_id = p_run_id and not applied;
end;
$func$;
