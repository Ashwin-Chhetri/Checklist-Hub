-- ============================================================
-- Additional profile fields collected during onboarding
-- ============================================================

alter table profiles
  add column profession text,
  add column location text;
