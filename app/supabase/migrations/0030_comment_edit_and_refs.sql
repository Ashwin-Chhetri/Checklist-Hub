-- Discussion panel redesign: editable comments + generalized entity tags
-- (synonyms, authority conflicts, evidence sources) that have no stable
-- uuid of their own, unlike users (`mentions`) and species (`mentioned_species`).

alter table species_comments
  add column edited_at timestamptz,
  add column mentioned_refs jsonb not null default '[]'::jsonb;
