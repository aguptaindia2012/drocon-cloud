-- ============================================================================
-- DroCon Cloud — Authorized Partner expansion
-- Number of drones the partner provides + their MSA responsibilities. Safe to re-run.
-- ============================================================================
alter table public.authorized_partners add column if not exists drones_provided numeric;
alter table public.authorized_partners add column if not exists responsibilities text;
