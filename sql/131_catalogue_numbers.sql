-- ============================================================================
-- 131. Catalogue Part / Service numbers (for BOM + quote/invoice cross-ref)
-- ----------------------------------------------------------------------------
-- Spares get a Part number, services get a Service number. Assigned once and
-- stable; they flow onto quotation/invoice/BOM lines so a product can be found
-- by its number everywhere. Format is app-managed (e.g. PRT-0001 / SRV-0001),
-- auto-assigned to the next free value on create but editable.
-- Additive & idempotent.
-- ============================================================================
alter table public.spare_catalogue   add column if not exists part_no    text;
alter table public.service_catalogue add column if not exists service_no text;

-- unique when present (two items can't share a number); NULLs allowed
create unique index if not exists spare_catalogue_part_no_uk
  on public.spare_catalogue(part_no) where part_no is not null;
create unique index if not exists service_catalogue_service_no_uk
  on public.service_catalogue(service_no) where service_no is not null;

comment on column public.spare_catalogue.part_no    is 'Part number (app-assigned, e.g. PRT-0001); flows onto quote/invoice/BOM lines.';
comment on column public.service_catalogue.service_no is 'Service number (app-assigned, e.g. SRV-0001); flows onto quote/invoice lines.';
