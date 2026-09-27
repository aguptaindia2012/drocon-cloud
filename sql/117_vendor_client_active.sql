-- ============================================================================
-- 117. Active/Inactive flag for Vendors and Clients
-- ----------------------------------------------------------------------------
-- Adds an is_active flag so the registers can filter Active/Inactive and
-- deactivate a record in place (existing rows default to active).
-- ============================================================================
alter table public.vendors add column if not exists is_active boolean not null default true;
alter table public.clients add column if not exists is_active boolean not null default true;
