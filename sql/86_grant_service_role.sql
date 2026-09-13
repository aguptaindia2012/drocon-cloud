-- ============================================================================
-- 86. Restore service_role's table privileges on the public schema
-- ----------------------------------------------------------------------------
-- The admin-users Edge Function connects with the service_role key but hit
-- "permission denied for table profiles" — meaning service_role was missing the
-- normal Supabase grants on public. This restores them (usage + all on tables/
-- sequences, and default privileges for future tables).
--
-- Safe: service_role is a server-only key (never in the browser). It already
-- bypasses RLS; this only re-adds the table-level GRANTs it's supposed to have.
-- Does not change anon/authenticated privileges or any RLS policy.
-- Idempotent.
-- ============================================================================
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines  in schema public to service_role;

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
