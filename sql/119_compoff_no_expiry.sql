-- ============================================================================
-- 119. Comp-offs carry forward — no expiry
-- ----------------------------------------------------------------------------
-- Policy change: a comp-off earned by working a Sunday/holiday now carries
-- forward INDEFINITELY until it is used (as a day off) or encashed. It no
-- longer lapses at the end of the calendar quarter. Implemented by stamping a
-- far-future expires_on so simulateLeave / FnF keep treating it as "open".
-- Existing non-encashed credits are revived (e.g. September ones in October).
-- ============================================================================
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

  if extract(dow from new.work_date) = 0 then
    is_off := true; src := 'sunday';
  elsif exists (select 1 from public.hr_holidays h where h.holiday_date = new.work_date) then
    is_off := true; src := 'holiday';
  end if;

  if new.status = 'worked_off' and is_off then
    if exists (select 1 from public.hr_comp_offs where attendance_id = new.id and encashed_on is null) then
      update public.hr_comp_offs
         set employee_id = new.employee_id, earned_on = new.work_date,
             source = src, expires_on = DATE '9999-12-31'   -- never expires
       where attendance_id = new.id and encashed_on is null;
    elsif not exists (select 1 from public.hr_comp_offs where attendance_id = new.id) then
      insert into public.hr_comp_offs(employee_id, attendance_id, earned_on, source, expires_on, created_by)
        values (new.employee_id, new.id, new.work_date, src, DATE '9999-12-31', new.created_by);
    end if;
  else
    delete from public.hr_comp_offs where attendance_id = new.id and encashed_on is null;
  end if;
  return new;
end $$;

-- Carry forward every comp-off still on the books (non-encashed): clear the
-- old quarter-end expiry so credits earned in earlier quarters stay available.
update public.hr_comp_offs set expires_on = DATE '9999-12-31' where encashed_on is null;
