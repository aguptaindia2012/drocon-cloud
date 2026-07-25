-- ============================================================================
-- 55. Incentives key on the EMPLOYEE (designation = Pilot), not vendor pilots
-- ----------------------------------------------------------------------------
-- DroCon's own pilots are HR employees whose designation marks them a pilot;
-- the vendor "pilots" master is a different set. Incentives should therefore be
-- keyed on employee_id, with acreage matched to the employee by name against
-- the acre entries. Additive: adds employee_id and moves the uniqueness onto it.
-- (The feature is new; pilot_id stays for reference but is no longer required.)
-- ============================================================================

alter table public.hr_incentives
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

-- move the per-month uniqueness from pilot_id to employee_id
alter table public.hr_incentives drop constraint if exists hr_incentives_period_month_pilot_id_key;
create unique index if not exists hr_incentives_period_emp_uk
  on public.hr_incentives(period_month, employee_id);
