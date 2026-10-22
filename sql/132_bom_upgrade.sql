-- ============================================================================
-- 132. BOM calculator upgrade — product number + revenue category
-- ----------------------------------------------------------------------------
-- A BOM now costs a PRODUCT (an assembly we build from catalogue parts: landing
-- gears, propeller sets, power cables, converters, drones). It carries:
--   part_no      — the resulting product's part number (new → next PRT-, or an
--                  existing catalogue part number when re-costing after a price change)
--   rev_category — the product's revenue category (shared profit-category keys)
-- The parts list (jsonb `parts`) already exists; catalogue-picked parts also
-- store their own part/service number + catalogue id inside each part object.
-- Approval columns (approval_status/assigned_approver/…) already exist on
-- bom_designs (used by the approvals bar). Additive & idempotent.
-- ============================================================================
alter table public.bom_designs add column if not exists part_no      text;
alter table public.bom_designs add column if not exists rev_category text;

comment on column public.bom_designs.part_no      is 'Part number of the product this BOM costs (new = next PRT-, or an existing catalogue part number for a revision).';
comment on column public.bom_designs.rev_category is 'Revenue/profit category of the product (window.OPS.profitCats keys).';
