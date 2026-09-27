-- ============================================================================
-- 118. Mill / Party on a pilot acre report
-- ----------------------------------------------------------------------------
-- Optional Mill/Party the pilot enters on the Report Acres form (e.g.
-- "Shree ji mill"), stored on the report and used in the drafted WhatsApp
-- message. submit_pilot_report gains p_mill.
-- ============================================================================
alter table public.pilot_acre_reports add column if not exists mill text;

drop function if exists public.submit_pilot_report(uuid, date, jsonb, text, uuid, text);
create or replace function public.submit_pilot_report(
  p_location uuid, p_date date, p_rows jsonb, p_note text default null, p_id uuid default null,
  p_reason text default null, p_mill text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pilot uuid := public.my_pilot_id(); v_vendor uuid := public.my_vendor_id(); rid uuid; locnm text;
begin
  if v_pilot is null then raise exception 'Not a pilot login'; end if;
  if not exists (select 1 from public.pilot_assignments pa
                  where pa.pilot_id = v_pilot and pa.location_id = p_location
                    and coalesce(pa.status,'active') <> 'closed') then
    raise exception 'You are not assigned to this location — ask DroCon to assign you'; end if;
  select name into locnm from public.spray_locations where id = p_location;
  if p_id is not null then
    update public.pilot_acre_reports
       set location_id=p_location, location_name=locnm, entry_date=p_date, rows=coalesce(p_rows,'[]'::jsonb),
           note=p_note, short_reason=p_reason, mill=p_mill, status='submitted', reject_reason=null, updated_at=now()
     where id=p_id and pilot_id=v_pilot and status in ('submitted','rejected')
     returning id into rid;
    if rid is null then raise exception 'This report can no longer be edited'; end if;
    return rid;
  end if;
  insert into public.pilot_acre_reports(pilot_id, vendor_id, entry_date, location_id, location_name, rows, note, short_reason, mill, status, submitted_by)
    values (v_pilot, v_vendor, p_date, p_location, locnm, coalesce(p_rows,'[]'::jsonb), p_note, p_reason, p_mill, 'submitted', auth.uid())
    returning id into rid;
  return rid;
end $$;
grant execute on function public.submit_pilot_report(uuid, date, jsonb, text, uuid, text, text) to authenticated;
