-- ============================================================================
-- 52. Salary month lock — freeze a month once its salaries are posted
-- ----------------------------------------------------------------------------
-- Everything about a salary month (attendance, calculation, payslips) stays
-- fully redoable UNTIL the month is posted+locked. Locking freezes the inputs
-- so posted figures can't silently drift. Editing afterwards must go through an
-- approver, who REOPENS the month (audited), makes the correction, and re-locks.
--
-- Guards (DB-level, cannot be bypassed by the UI):
--   * salary_runs : blocks inserts and any change to salary FIGURES while
--                   locked; still allows status/payment transitions (posted->paid)
--   * hr_attendance : blocks all edits for a locked month
--   * payslips    : blocks (re)generation while locked
-- Additive — creates one table + guard triggers; nothing dropped, no data lost.
-- ============================================================================

create table if not exists public.hr_month_locks (
  period_month text primary key,                 -- 'YYYY-MM'
  status       text not null default 'locked' check (status in ('locked','reopened')),
  locked_by    uuid references public.profiles(id),
  locked_at    timestamptz not null default now(),
  reopened_by  uuid references public.profiles(id),
  reopened_at  timestamptz,
  reopen_note  text
);

create or replace function public.is_month_locked(ym text)
returns boolean language sql stable as $$
  select exists (select 1 from public.hr_month_locks where period_month = ym and status = 'locked');
$$;

-- salary_runs: freeze the figures, allow status/payment transitions
create or replace function public.guard_salary_lock()
returns trigger language plpgsql as $$
begin
  if public.is_month_locked(new.period_month) then
    if tg_op = 'INSERT' then
      raise exception 'Salary month % is locked. An approver must reopen it before recalculating.', new.period_month;
    elsif tg_op = 'UPDATE' and (
         new.net_payable    is distinct from old.net_payable  or
         new.lop_days       is distinct from old.lop_days     or
         new.working_days   is distinct from old.working_days or
         new.off_days       is distinct from old.off_days     or
         new.monthly_salary is distinct from old.monthly_salary or
         new.month_worked   is distinct from old.month_worked) then
      raise exception 'Salary month % is locked. Reopen it to change salary figures (status & payments are still allowed).', new.period_month;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists salary_runs_lock on public.salary_runs;
create trigger salary_runs_lock before insert or update on public.salary_runs
  for each row execute function public.guard_salary_lock();

-- hr_attendance: no edits at all for a locked month
create or replace function public.guard_attendance_lock()
returns trigger language plpgsql as $$
declare ym text;
begin
  ym := to_char(coalesce(new.work_date, old.work_date), 'YYYY-MM');
  if public.is_month_locked(ym) then
    raise exception 'Attendance for % is locked (salaries posted). An approver must reopen the month to edit it.', ym;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists hr_attendance_lock on public.hr_attendance;
create trigger hr_attendance_lock before insert or update or delete on public.hr_attendance
  for each row execute function public.guard_attendance_lock();

-- payslips: no (re)generation for a locked month
create or replace function public.guard_payslip_lock()
returns trigger language plpgsql as $$
begin
  if public.is_month_locked(new.period_month) then
    raise exception 'Payslips for % are locked. Reopen the month to regenerate them.', new.period_month;
  end if;
  return new;
end $$;
drop trigger if exists payslips_lock on public.payslips;
create trigger payslips_lock before insert or update on public.payslips
  for each row execute function public.guard_payslip_lock();

-- RLS: everyone internal can read the lock state; only approvers/admins may
-- lock or reopen a month.
alter table public.hr_month_locks enable row level security;
drop policy if exists hr_month_locks_read   on public.hr_month_locks;
drop policy if exists hr_month_locks_write  on public.hr_month_locks;
drop policy if exists hr_month_locks_update on public.hr_month_locks;
create policy hr_month_locks_read   on public.hr_month_locks for select to authenticated using (true);
create policy hr_month_locks_write  on public.hr_month_locks for insert to authenticated
  with check (public.has_role(array['admin','approver']::user_role[]));
create policy hr_month_locks_update on public.hr_month_locks for update to authenticated
  using (public.has_role(array['admin','approver']::user_role[]));

grant select, insert, update on public.hr_month_locks to authenticated;
