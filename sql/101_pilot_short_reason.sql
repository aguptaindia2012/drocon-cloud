-- ============================================================================
-- 101. Let a pilot record a short-day reason for their own assigned location
-- ----------------------------------------------------------------------------
-- The pilot's Report Acres form asks for a reason when their day total is low.
-- Pilots are external and can't call set_short_day_reason, so this dedicated
-- RPC verifies the caller is a pilot with an ACTIVE assignment to the location,
-- forces the pilot name from the register (can't spoof), and upserts the log.
-- Threshold is enforced in the UI (15 ac for pilots); this just records.
-- ============================================================================
create or replace function public.pilot_report_short_reason(
  p_date date, p_location uuid, p_acres numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_pilot uuid := public.my_pilot_id(); v_name text;
begin
  if v_pilot is null then raise exception 'Only a pilot login can record this'; end if;
  if not exists (select 1 from public.pilot_assignments pa
                  where pa.pilot_id = v_pilot and pa.location_id = p_location
                    and coalesce(pa.status,'active') = 'active') then
    raise exception 'You are not assigned to this location';
  end if;
  select name into v_name from public.pilots where id = v_pilot;
  insert into public.short_day_logs(entry_date, location_id, location_name, pilot_name, acres, reason, recorded_by)
  values (p_date, p_location, (select name from public.spray_locations where id = p_location),
          coalesce(nullif(btrim(v_name),''),'(unassigned)'), p_acres, p_reason, auth.uid())
  on conflict (entry_date, location_id, pilot_name) do update
     set reason = excluded.reason,
         acres = coalesce(excluded.acres, public.short_day_logs.acres),
         recorded_by = auth.uid(), updated_at = now();
end $$;
grant execute on function public.pilot_report_short_reason(date, uuid, numeric, text) to authenticated;
