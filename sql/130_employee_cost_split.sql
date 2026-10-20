-- ============================================================================
-- 130. Employee salary profit-split (category-wise P&L — Phase 2b)
-- ----------------------------------------------------------------------------
-- An employee's standard salary allocation across profit categories, as a jsonb
-- of percentages that should sum to <=100 (any remainder is treated as
-- overheads), e.g. {"spray":70,"demo":30}. This is the reusable default; each
-- monthly salary_run is stamped with it at save time (salary_runs.cost_split
-- from migration 129), so history is preserved even if the default later changes.
-- NULL => the whole salary is overheads in the P&L report.
-- Additive & idempotent.
-- ============================================================================
alter table public.employees add column if not exists cost_split jsonb;
comment on column public.employees.cost_split is 'Standard salary profit-split jsonb {category:percent}, sum<=100, remainder=overheads; NULL => all overheads.';
