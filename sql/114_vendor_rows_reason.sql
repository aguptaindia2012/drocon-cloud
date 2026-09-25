-- ============================================================================
-- 114. Vendor Entries: include the short-day reason per line
-- ----------------------------------------------------------------------------
-- Left-joins short_day_logs so the vendor Entries list can show the recorded
-- short-day reason, matching the client feed (sql/104) and internal views.
-- Return type changes, so drop first.
-- ============================================================================
drop function if exists public.vendor_acre_rows(date, date, uuid);

create or replace function public.vendor_acre_rows(p_from date default null, p_to date default null, p_vendor uuid default null)
returns table(entry_date date, location_id uuid, location_name text, pilot_name text, crop text, acres numeric, billed boolean, short_reason text)
language sql stable security definer set search_path = public as $$
  with v as (select case when public.is_internal() and p_vendor is not null then p_vendor else public.my_vendor_id() end as vid)
  select a.entry_date, a.location_id, l.name,
         coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)') as pilot_name,
         a.crop, a.acres, (a.vendor_doc_id is not null) as billed,
         sdl.reason as short_reason
    from public.acre_entries a
    join public.pilots p on p.id = a.pilot_id
    join public.spray_locations l on l.id = a.location_id
    left join public.short_day_logs sdl
      on sdl.entry_date = a.entry_date and sdl.location_id = a.location_id
     and sdl.pilot_name = coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)')
   where p.vendor_id = (select vid from v)
     and coalesce(a.approval_status,'approved') = 'approved'
     and coalesce(a.acres,0) > 0
     and (p_from is null or a.entry_date >= p_from)
     and (p_to   is null or a.entry_date <= p_to)
   order by a.entry_date desc, l.name;
$$;
grant execute on function public.vendor_acre_rows(date, date, uuid) to authenticated;
