-- ============================================================================
-- 39. Item cost on the catalogue (base + shipping) to drive margin review
-- ----------------------------------------------------------------------------
-- Cost is INTERNAL: it is snapshotted onto the document line when an item is
-- picked, shown while building and reviewing the document, and never printed
-- on the customer's copy.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

alter table public.service_catalogue add column if not exists cost_base     numeric not null default 0;
alter table public.service_catalogue add column if not exists cost_shipping numeric not null default 0;

alter table public.spare_catalogue   add column if not exists cost_base     numeric not null default 0;
alter table public.spare_catalogue   add column if not exists cost_shipping numeric not null default 0;

comment on column public.service_catalogue.cost_base     is 'Internal landed cost before shipping — never printed on documents';
comment on column public.service_catalogue.cost_shipping is 'Internal shipping/freight cost — never printed on documents';
comment on column public.spare_catalogue.cost_base       is 'Internal landed cost before shipping — never printed on documents';
comment on column public.spare_catalogue.cost_shipping   is 'Internal shipping/freight cost — never printed on documents';
