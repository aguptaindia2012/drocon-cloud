-- ============================================================================
-- DroCon Cloud — HR / Payroll (Phase 4)
-- Employees & consultants, monthly salary runs (attendance/LOP-adjusted net pay),
-- salary payments, and a light accounting ledger. Run AFTER 05_grant_privileges
-- (so default privileges are already set for these new tables).
-- ============================================================================

-- employees & consultants master
create table if not exists public.employees (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  designation    text,
  emp_type       text not null default 'employee' check (emp_type in ('employee','consultant')),
  monthly_salary numeric not null default 0,
  doj            date,                    -- date of joining
  dol            date,                    -- date of leaving (null = active)
  phone          text,
  email          text,
  status         text not null default 'active' check (status in ('active','inactive')),
  bank_details   text,
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- one salary run per employee per month
create table if not exists public.salary_runs (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid references public.employees(id) on delete cascade,
  period_month   text not null,           -- 'YYYY-MM'
  period_start   date,
  period_end     date,
  monthly_salary numeric,                  -- snapshot at calculation time
  working_days   numeric,                  -- engaged calendar days in the period
  off_days       numeric,                  -- sundays + holidays (informational)
  lop_days       numeric default 0,        -- loss-of-pay / unauthorised absence
  month_days     numeric,                  -- days in the month
  month_worked   numeric,                  -- effective fraction worked
  net_payable    numeric,
  status         text not null default 'calculated' check (status in ('calculated','posted','paid')),
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists salary_runs_uniq on public.salary_runs(employee_id, period_month);
create index if not exists salary_runs_month_idx on public.salary_runs(period_month);

-- payments against salary runs
create table if not exists public.salary_payments (
  id            bigint generated always as identity primary key,
  salary_run_id uuid references public.salary_runs(id) on delete cascade,
  amount        numeric not null,
  paid_on       date not null default current_date,
  mode          text,
  note          text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

-- light accounting ledger (salary expense / payable / bank postings)
create table if not exists public.accounting_entries (
  id           bigint generated always as identity primary key,
  voucher_date date not null default current_date,
  narration    text,
  account      text not null,             -- e.g. 'Salaries & Wages', 'Salaries Payable', 'Bank'
  debit        numeric default 0,
  credit       numeric default 0,
  ref_type     text,                      -- 'salary_run' | 'salary_payment' | ...
  ref_id       text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists acct_date_idx on public.accounting_entries(voucher_date desc);

-- updated_at triggers
do $$ declare t text;
begin
  foreach t in array array['employees','salary_runs'] loop
    execute format('drop trigger if exists %I_touch on public.%I;', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at_ops();', t, t);
  end loop;
end $$;

-- RLS: team read, authenticated write, creator/admin delete
do $$ declare t text;
begin
  foreach t in array array['employees','salary_runs','salary_payments','accounting_entries'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true);', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (true);', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (true);', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.has_role(array[''admin'',''approver'']::user_role[]) or created_by = auth.uid());', t, t);
  end loop;
end $$;

-- explicit grants (belt-and-suspenders; default privileges from 05 should already cover)
grant select, insert, update, delete on public.employees, public.salary_runs, public.salary_payments, public.accounting_entries to authenticated;
grant usage, select on all sequences in schema public to authenticated;
