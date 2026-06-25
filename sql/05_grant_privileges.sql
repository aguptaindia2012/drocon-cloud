-- ============================================================================
-- DroCon Cloud — API role privileges
-- Some Supabase projects do NOT auto-grant table privileges to the API roles
-- (anon / authenticated). Without these GRANTs, PostgREST returns
-- "42501 permission denied for table ..." even though RLS policies exist.
-- These grants give the roles table access; ROW-LEVEL SECURITY still governs
-- exactly which rows each user can see/change.
-- Safe to run multiple times. Run this once on an existing project; it is also
-- included at the end of ALL_IN_ONE.sql for fresh setups.
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- existing objects
grant select, insert, update, delete on all tables    in schema public to authenticated;
grant usage,  select                  on all sequences in schema public to authenticated;
grant execute                         on all functions in schema public to anon, authenticated;

-- future objects (so later migrations inherit the grants automatically)
alter default privileges in schema public grant select, insert, update, delete on tables    to authenticated;
alter default privileges in schema public grant usage,  select                  on sequences to authenticated;
alter default privileges in schema public grant execute                         on functions to anon, authenticated;

-- ============================================================================
-- After running this: in the app, click the role pill (top-right) to refresh,
-- or sign out and back in. The first user you created is the admin.
-- ============================================================================
