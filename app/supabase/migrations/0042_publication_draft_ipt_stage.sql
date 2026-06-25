-- The publish wizard gains a fourth stage ("ipt", the guided handoff to
-- publishing the DwC-A package through IPT) between "review" and the final
-- "done" screen — widen the draft stage check constraint to allow it.

alter table checklist_publication_drafts drop constraint checklist_publication_drafts_stage_check;
alter table checklist_publication_drafts add constraint checklist_publication_drafts_stage_check
  check (stage in ('metadata', 'review', 'ipt'));
