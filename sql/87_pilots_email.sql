-- ============================================================================
-- 87. Pilots: add an email column (for provisioning a pilot portal login)
-- ----------------------------------------------------------------------------
-- Pilots link to their login via profiles.party_type='pilot' + party_id=pilots.id,
-- but the pilots table had no email to provision an account with. Additive.
-- ============================================================================
alter table public.pilots add column if not exists email text;
