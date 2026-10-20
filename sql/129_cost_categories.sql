-- ============================================================================
-- 129. Profit categories on the COST side (category-wise P&L — Phase 2)
-- ----------------------------------------------------------------------------
-- Mirrors the revenue category dimension (window.OPS.profitCats) onto every
-- cost source, so profit can be computed per category:
--     category profit = revenue(cat) - direct cost(cat)
-- "overheads" is a cost-only catch-all for common/indivisible spend; it stays
-- in the OVERALL profit but is not attributed to any single category.
--
-- Valid keys (enforced in the app, kept loose here for forward-compat):
--   spray | demo | part | service | dronesale | other | overheads
--
-- Single-category costs carry `cost_category`. Salaries can straddle several
-- categories, so salary_runs carries a `cost_split` jsonb of percentages that
-- should sum to 100, e.g. {"spray":70,"demo":30}. A NULL/empty split means the
-- whole salary is treated as overheads by the P&L report.
-- Additive & idempotent — safe to re-run.
-- ============================================================================

-- Direct expenses (Expense Management)
alter table public.expenses        add column if not exists cost_category text;
-- Supplier invoices / vendor bills
alter table public.payables        add column if not exists cost_category text;
-- Vendor -> DroCon spray-payout invoices (these are spraying cost by nature)
alter table public.vendor_invoices add column if not exists cost_category text default 'spray';
-- Employee expense claims
alter table public.expense_claims  add column if not exists cost_category text;
-- Pilot acreage incentives (spraying cost by nature)
alter table public.hr_incentives   add column if not exists cost_category text default 'spray';
-- Ad-hoc bonuses
alter table public.hr_bonuses      add column if not exists cost_category text;

-- Salaries: percentage split across categories (sums to 100). NULL => overheads.
alter table public.salary_runs     add column if not exists cost_split jsonb;

comment on column public.expenses.cost_category        is 'Profit category (window.OPS.profitCats). NULL => overheads in P&L.';
comment on column public.payables.cost_category        is 'Profit category of this supplier bill. NULL => overheads in P&L.';
comment on column public.vendor_invoices.cost_category is 'Profit category; spray payouts default to spray.';
comment on column public.expense_claims.cost_category  is 'Profit category of this employee claim. NULL => overheads.';
comment on column public.hr_incentives.cost_category   is 'Profit category; pilot incentives default to spray.';
comment on column public.hr_bonuses.cost_category      is 'Profit category of this bonus. NULL => overheads.';
comment on column public.salary_runs.cost_split        is 'jsonb {category:percent} summing to 100; NULL => 100% overheads.';
