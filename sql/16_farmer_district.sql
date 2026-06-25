-- ============================================================================
-- DroCon Cloud — add district to farmer sprays (state already exists).
-- Old rows leave it blank; new entries capture it. Safe to re-run.
-- ============================================================================
alter table public.farmer_sprays add column if not exists district text;
alter table public.potential_orders add column if not exists district text;
