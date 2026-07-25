-- ============================================================================
-- 58. Authorized-Partner billing model: Full Client Rate + Acreage Contribution
-- ----------------------------------------------------------------------------
-- Each authorized partner can bill on one of two models:
--   * 'commission'         — existing per-farmer % slabs (partner_rates)
--   * 'full_client_rate'   — partner is paid 100% of the client rate for every
--                            acre; DroCon's margin is realised in kind as a daily
--                            Acreage Contribution valued at the client rate:
--                              day's order  > threshold_acres  -> contribution_above acre/day
--                              day's order <= threshold_acres  -> contribution_upto  acre/day
--                            (negotiated defaults 7 / 1.0 / 0.5; downtime days waivable).
-- partner_billing holds the per-partner (or standard/null) model + parameters.
-- Additive.
-- ============================================================================

create table if not exists public.partner_billing (
  id                 uuid primary key default gen_random_uuid(),
  partner_id         uuid references public.authorized_partners(id) on delete cascade,  -- null = Standard/default
  model              text not null default 'commission' check (model in ('commission','full_client_rate')),
  threshold_acres    numeric not null default 7,
  contribution_above numeric not null default 1.0,
  contribution_upto  numeric not null default 0.5,
  created_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now()
);
-- one config per partner, and only one Standard (null-partner) row
create unique index if not exists partner_billing_partner_uk on public.partner_billing(partner_id) where partner_id is not null;
create unique index if not exists partner_billing_standard_uk on public.partner_billing((1)) where partner_id is null;

-- record which model an invoice was filed under (its lines are shaped accordingly)
alter table public.partner_invoices add column if not exists billing_model text not null default 'commission';

alter table public.partner_billing enable row level security;
drop policy if exists partner_billing_read  on public.partner_billing;
drop policy if exists partner_billing_write on public.partner_billing;
-- readable by any authenticated user (a partner needs to know their own model)
create policy partner_billing_read  on public.partner_billing for select to authenticated using (true);
create policy partner_billing_write on public.partner_billing for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));

grant select, insert, update, delete on public.partner_billing to authenticated;
