-- ============================================================================
-- 54. Leave netting model change + Notice period & Full-and-Final settlement
-- ----------------------------------------------------------------------------
-- NEW leave model (replaces the explicit "comp-off used" mark):
--   Attendance is marked P (present) / A (absent, a day off taken) / W (worked
--   on a Sunday/holiday -> earns a comp-off). Absences are netted against the
--   running comp-off balance: while the balance is positive an absence is paid
--   leave (consumes a comp-off, FIFO by expiry); once the balance is exhausted
--   further absences become LOP and reduce salary. Positive balances are still
--   managed quarterly (encash / lapse). The netting itself is computed in the
--   app from raw credits + absences, so this migration only:
--     * folds legacy 'comp_used' marks into 'absent' (same meaning now)
--     * narrows the status check to ('absent','worked_off')
--
-- Notice period (HR Policy v2.0): 15 days' notice; short notice deducts the
-- shortfall days of salary. Final settlement is due 30 days after the last
-- working day. hr_final_settlements records each FnF for audit + posting.
-- Additive except the in-place status fold (reversible in meaning).
-- ============================================================================

-- --- fold legacy comp_used -> absent, then narrow the constraint -----------
-- The lock guard would refuse edits on a locked month; suspend it just for
-- this data fold (the compoff sync trigger is harmless on these rows).
alter table public.hr_attendance disable trigger hr_attendance_lock;
update public.hr_attendance set status='absent' where status='comp_used';
alter table public.hr_attendance enable trigger hr_attendance_lock;

alter table public.hr_attendance drop constraint if exists hr_attendance_status_check;
alter table public.hr_attendance
  add constraint hr_attendance_status_check check (status in ('absent','worked_off'));

-- ---------------------------------------------------------------------------
-- Full & Final settlement
-- ---------------------------------------------------------------------------
create table if not exists public.hr_final_settlements (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  resignation_date   date,
  last_working_day   date not null,
  notice_required    integer not null default 15,
  notice_days_given  integer,
  shortfall_days     integer default 0,
  daily_rate         numeric default 0,
  earned_salary      numeric default 0,   -- unpaid salary up to last working day
  leave_encashment   numeric default 0,   -- positive comp-off balance paid out
  other_additions    numeric default 0,
  notice_deduction   numeric default 0,   -- shortfall_days * daily_rate
  advance_recovery   numeric default 0,   -- outstanding employee advances
  other_deductions   numeric default 0,
  net_payable        numeric default 0,
  settlement_due_date date,               -- last_working_day + 30
  status             text not null default 'draft' check (status in ('draft','settled')),
  mode               text,
  settled_on         date,
  note               text,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists hr_fnf_emp_idx on public.hr_final_settlements(employee_id);

drop trigger if exists hr_fnf_touch on public.hr_final_settlements;
create trigger hr_fnf_touch before update on public.hr_final_settlements
  for each row execute function public.touch_updated_at_ops();

alter table public.hr_final_settlements enable row level security;
drop policy if exists hr_fnf_read   on public.hr_final_settlements;
drop policy if exists hr_fnf_insert on public.hr_final_settlements;
drop policy if exists hr_fnf_update on public.hr_final_settlements;
drop policy if exists hr_fnf_delete on public.hr_final_settlements;
create policy hr_fnf_read   on public.hr_final_settlements for select to authenticated using (true);
create policy hr_fnf_insert on public.hr_final_settlements for insert to authenticated with check (true);
create policy hr_fnf_update on public.hr_final_settlements for update to authenticated using (true);
create policy hr_fnf_delete on public.hr_final_settlements for delete to authenticated
  using (public.has_role(array['admin','approver']::user_role[]) or created_by = auth.uid());

grant select, insert, update, delete on public.hr_final_settlements to authenticated;
