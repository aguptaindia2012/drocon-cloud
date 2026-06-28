-- ============================================================================
-- DroCon Cloud — Payslips (#11)
-- Per-employee configurable deductions (text lines like "PPF=12%" or
-- "Advance=2000"). Payslips are generated from the monthly salary run by an
-- admin, approved by an admin, and exported as a letterheaded Word document.
-- Consultants are excluded (employees only). Safe to re-run.
-- ============================================================================
alter table public.employees add column if not exists deductions_text text;

create table if not exists public.payslips (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references public.employees(id) on delete cascade,
  period_month  text not null,                 -- 'YYYY-MM'
  base          numeric,                        -- earned (attendance-adjusted) pay
  deductions    jsonb default '[]',             -- [{name, amount}]
  net           numeric,
  status        text not null default 'draft',  -- draft | approved
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists payslips_uniq on public.payslips(employee_id, period_month);

alter table public.payslips enable row level security;
-- read: HR-access holders; write/approve: admins only
drop policy if exists payslips_read on public.payslips;
create policy payslips_read on public.payslips for select to authenticated using (public.has_hr_access());
drop policy if exists payslips_write on public.payslips;
create policy payslips_write on public.payslips for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));
grant select, insert, update, delete on public.payslips to authenticated;
