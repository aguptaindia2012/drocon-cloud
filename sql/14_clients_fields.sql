-- ============================================================================
-- DroCon Cloud — client master fields (align to the Client Setup structure)
-- Adds the client reference number and district. Safe to re-run.
-- ============================================================================
alter table public.clients add column if not exists client_ref text;
alter table public.clients add column if not exists district  text;
