-- ============================================================================
-- DroCon Cloud — BOM design context (client + delivery location + type)
-- Captures the potential client and delivery State/District (for logistics
-- estimation) and whether it's an agriculture design. Labour & logistics are
-- captured as line items in the parts list. Safe to re-run.
-- ============================================================================
alter table public.bom_designs add column if not exists client_name       text;
alter table public.bom_designs add column if not exists delivery_state     text;
alter table public.bom_designs add column if not exists delivery_district  text;
alter table public.bom_designs add column if not exists design_type        text default 'agriculture';
