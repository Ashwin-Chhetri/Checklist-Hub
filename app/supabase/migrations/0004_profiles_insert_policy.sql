-- ============================================================
-- Allow users to insert their own profile row (needed for upsert
-- from the onboarding flow when the trigger-created row is missing)
-- ============================================================

create policy "profiles_insert_own" on profiles
  for insert to authenticated with check (id = auth.uid());
