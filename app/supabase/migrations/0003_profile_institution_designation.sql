-- ============================================================
-- Additional profile fields: institution and designation
-- ============================================================

alter table profiles
  add column institution text,
  add column designation text;
