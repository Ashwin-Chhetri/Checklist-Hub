-- ORCID sign-in: Supabase Auth has no built-in ORCID provider, so the OAuth
-- dance is handled by our own routes (src/app/api/auth/orcid/*) and a
-- Supabase user is created/matched by ORCID iD rather than email (ORCID's
-- free/public API does not expose the user's real email address).

alter table profiles add column orcid_id text unique;
