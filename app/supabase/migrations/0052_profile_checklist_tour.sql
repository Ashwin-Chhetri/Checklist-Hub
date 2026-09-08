-- Tracks whether a user has completed (or skipped) the first-time guided
-- tour of the "Create Checklist" wizard, so it's shown at most once per
-- account instead of re-appearing every time they open the wizard.

alter table profiles add column has_seen_checklist_tour boolean not null default false;
