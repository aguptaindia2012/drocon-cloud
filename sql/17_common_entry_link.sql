-- ============================================================================
-- DroCon Cloud — link Farmer & Acre rows entered via the common Daily Entry form
-- A shared source_id lets the two trackers stay separate (for client
-- reconciliation) while being entered once. Safe to re-run.
-- ============================================================================
alter table public.farmer_sprays add column if not exists source_id uuid;
alter table public.acre_entries  add column if not exists source_id uuid;
create index if not exists farmer_source_idx on public.farmer_sprays(source_id);
create index if not exists acre_source_idx   on public.acre_entries(source_id);
