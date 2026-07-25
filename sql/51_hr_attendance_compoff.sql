-- ============================================================================
-- 51. HR Attendance + Comp-off (earned-leave) engine
-- ----------------------------------------------------------------------------
-- Drocon has no standard annual/sick leave. Instead:
--   * Each month HR declares that month's holidays (Sundays are automatic).
--   * Attendance is marked per employee per day. A normal working day defaults
--     to Present; deviations (Absent / Comp-off used / Worked-on-day-off) are
--     the only rows stored.
--   * Working a Sunday or a declared holiday earns ONE comp-off, which expires
--     at the END OF THE CALENDAR QUARTER it was earned in. It can be used any
--     time before then, or encashed (daily rate = monthly salary / days in the
--     encashment month).
--   * Salary: Absent days flow into the Salary Calculator as LOP automatically.
--     Comp-off days are paid.
--
-- Design: comp-off credits are kept in step with attendance by a trigger, so
-- the ledger can never drift from what was actually marked. Encashed credits
-- are retained even if the underlying attendance row is later removed.
-- Additive — creates tables/functions only; nothing dropped, no data deleted.
-- ============================================================================

-- end of the calendar quarter that date d falls in (e.g. 2026-08-11 -> 2026-09-30)
create or replace function public.quarter_end(d date)
returns date language sql immutable as $$
  select (date_trunc('quarter', d::timestamp) + interval '3 months' - interval '1 day')::date;
$$;

-- ---------------------------------------------------------------------------
-- Holiday calendar
-- ---------------------------------------------------------------------------
create table if not exists public.hr_holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Attendance — one row per employee per day, only for non-Present days
-- ---------------------------------------------------------------------------
create table if not exists public.hr_attendance (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date   date not null,
  -- present is the default and is NOT stored; we only record deviations.
  status      text not null check (status in ('absent','comp_used','worked_off')),
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(employee_id, work_date)
);
create index if not exists hr_attendance_date_idx on public.hr_attendance(work_date);
create index if not exists hr_attendance_emp_idx  on public.hr_attendance(employee_id);

-- ---------------------------------------------------------------------------
-- Comp-off credit ledger (maintained by trigger from attendance)
-- ---------------------------------------------------------------------------
create table if not exists public.hr_comp_offs (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  -- SET NULL (not CASCADE): an ENCASHED credit must survive even if the
  -- originating attendance row is later edited/removed.
  attendance_id uuid references public.hr_attendance(id) on delete set null,
  earned_on     date not null,
  source        text not null check (source in ('sunday','holiday')),
  expires_on    date not null,        -- end of the calendar quarter of earned_on
  encashed_on   date,
  encash_amount numeric,
  encash_month  text,                 -- 'YYYY-MM' the encashment was booked in
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists hr_comp_offs_emp_idx on public.hr_comp_offs(employee_id);

-- Keep comp-off credits in lock-step with attendance.
--   worked_off on a Sunday/declared-holiday  -> ensure one OPEN credit exists
--   anything else / row removed              -> drop the OPEN credit (encashed kept)
create or replace function public.sync_comp_off()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_off boolean := false;
  src    text;
begin
  if tg_op = 'DELETE' then
    delete from public.hr_comp_offs where attendance_id = old.id and encashed_on is null;
    return old;
  end if;

  -- is new.work_date a day off? (Sunday, or a declared holiday)
  if extract(dow from new.work_date) = 0 then
    is_off := true; src := 'sunday';
  elsif exists (select 1 from public.hr_holidays h where h.holiday_date = new.work_date) then
    is_off := true; src := 'holiday';
  end if;

  if new.status = 'worked_off' and is_off then
    if exists (select 1 from public.hr_comp_offs where attendance_id = new.id and encashed_on is null) then
      update public.hr_comp_offs
         set employee_id = new.employee_id, earned_on = new.work_date,
             source = src, expires_on = public.quarter_end(new.work_date)
       where attendance_id = new.id and encashed_on is null;
    elsif not exists (select 1 from public.hr_comp_offs where attendance_id = new.id) then
      insert into public.hr_comp_offs(employee_id, attendance_id, earned_on, source, expires_on, created_by)
        values (new.employee_id, new.id, new.work_date, src,
                public.quarter_end(new.work_date), new.created_by);
    end if;
  else
    delete from public.hr_comp_offs where attendance_id = new.id and encashed_on is null;
  end if;
  return new;
end $$;
drop trigger if exists hr_attendance_compoff on public.hr_attendance;
create trigger hr_attendance_compoff after insert or update or delete on public.hr_attendance
  for each row execute function public.sync_comp_off();

-- updated_at touch on attendance
drop trigger if exists hr_attendance_touch on public.hr_attendance;
create trigger hr_attendance_touch before update on public.hr_attendance
  for each row execute function public.touch_updated_at_ops();

-- ---------------------------------------------------------------------------
-- RLS: internal read/write, creator/approver delete (mirrors sql/07)
-- ---------------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['hr_holidays','hr_attendance','hr_comp_offs'] loop
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

grant select, insert, update, delete on public.hr_holidays, public.hr_attendance, public.hr_comp_offs to authenticated;
grant usage, select on all sequences in schema public to authenticated;
