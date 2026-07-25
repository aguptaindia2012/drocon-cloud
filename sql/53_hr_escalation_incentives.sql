-- ============================================================================
-- 53. Salary escalations + Incentives + Bonuses (per DroCon HR policy v2.0)
-- ----------------------------------------------------------------------------
-- * hr_salary_revisions : dated salary changes (escalations). The Salary
--   Calculator uses the rate in force for the month being run.
-- * hr_incentives : monthly, per-PILOT, acreage-driven (policy Incentive Niti):
--       Tier 1  >= 400 acres -> 3,000 ;  Tier 2 >= 550 acres -> 7,000
--       No-Crash Bonus: zero crashes AND acreage >= 200 -> 3,000
--       Minor-incident waiver flagged when month repair cost <= 6,000
-- * hr_bonuses : ad-hoc discretionary bonuses to any employee/pilot.
-- Additive — tables only; nothing dropped, no data deleted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Salary escalations
-- ---------------------------------------------------------------------------
create table if not exists public.hr_salary_revisions (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id) on delete cascade,
  effective_from date not null,
  monthly_salary numeric not null check (monthly_salary >= 0),
  reason         text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists hr_salary_rev_idx on public.hr_salary_revisions(employee_id, effective_from);

-- ---------------------------------------------------------------------------
-- Monthly pilot incentives
-- ---------------------------------------------------------------------------
create table if not exists public.hr_incentives (
  id             uuid primary key default gen_random_uuid(),
  period_month   text not null,                 -- 'YYYY-MM'
  pilot_id       uuid references public.pilots(id) on delete set null,
  pilot_name     text,
  acres          numeric default 0,
  tier           text,                          -- 'tier1' | 'tier2' | null
  tier_amount    numeric default 0,
  crashes        integer default 0,
  repair_cost    numeric default 0,
  minor_waiver   boolean default true,
  no_crash_bonus numeric default 0,
  total          numeric default 0,
  status         text not null default 'calculated' check (status in ('calculated','paid')),
  paid_on        date,
  mode           text,
  note           text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique(period_month, pilot_id)
);
create index if not exists hr_incentives_month_idx on public.hr_incentives(period_month);

-- ---------------------------------------------------------------------------
-- Ad-hoc bonuses
-- ---------------------------------------------------------------------------
create table if not exists public.hr_bonuses (
  id          uuid primary key default gen_random_uuid(),
  pay_month   text,                             -- 'YYYY-MM' (grouping, optional)
  payee_kind  text check (payee_kind in ('employee','pilot','other')),
  payee_id    uuid,
  payee_name  text not null,
  title       text not null,
  amount      numeric not null check (amount > 0),
  reason      text,
  status      text not null default 'pending' check (status in ('pending','paid')),
  paid_on     date,
  mode        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists hr_bonuses_month_idx on public.hr_bonuses(pay_month);

-- updated_at touch
drop trigger if exists hr_incentives_touch on public.hr_incentives;
create trigger hr_incentives_touch before update on public.hr_incentives
  for each row execute function public.touch_updated_at_ops();

-- RLS: internal read/write, creator/approver delete (mirrors sql/07 & sql/51)
do $$ declare t text;
begin
  foreach t in array array['hr_salary_revisions','hr_incentives','hr_bonuses'] loop
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

grant select, insert, update, delete on public.hr_salary_revisions, public.hr_incentives, public.hr_bonuses to authenticated;
grant usage, select on all sequences in schema public to authenticated;
