-- ============================================================================
-- DroCon Cloud — split acre rate into client-paid + farmer-paid portions.
-- A spray may be billed partly to the client and partly to the farmer; the
-- effective rate = client_rate + farmer_rate. Safe to re-run.
-- ============================================================================
alter table public.acre_entries add column if not exists client_rate numeric;
alter table public.acre_entries add column if not exists farmer_rate numeric;
