-- ============================================================================
-- 46. Fix: creating a Location from the UI failed
-- ----------------------------------------------------------------------------
-- The Locations form sends created_by, but spray_locations never had that
-- column — so every "Create location" attempt failed with
--   "Could not find the 'created_by' column of 'spray_locations'".
-- It went unnoticed because locations used to be auto-created by
-- post_daily_submission(), which does not set created_by.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

alter table public.spray_locations
  add column if not exists created_by uuid references public.profiles(id);
