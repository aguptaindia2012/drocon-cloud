-- ============================================================================
-- 104. Client feed: include the short-day reason per line
-- ----------------------------------------------------------------------------
-- Left-joins short_day_logs so the client Entries list can show the recorded
-- short-day reason for that date/location/pilot. Recreates the feed functions
-- (return type change). Same scoping as sql/92.
-- ============================================================================
drop function if exists public.client_export_rows(date, date);
drop function if exists public.client_spray_rows(date, date, uuid);

create or replace function public.client_spray_rows(
  p_from date default null, p_to date default null, p_client uuid default null)
returns table(
  spray_id bigint, source_id uuid, entry_date date, location_id uuid, location_name text,
  farmer_name text, farmer_phone text, village text, crop text, medicine text, pilot text,
  acres numeric, farmer_rate numeric, client_rate numeric,
  farmer_amount numeric, client_amount numeric, amount numeric, gps boolean,
  short_reason text, open_issue boolean)
language sql stable security definer set search_path = public as $$
  with who as (
    select case when public.is_internal() and p_client is not null
                then p_client else public.my_client_id() end as client_id
  ), mine as (
    select cl.location_id from public.client_locations cl, who
     where cl.client_id = who.client_id
  )
  select f.id, f.source_id, f.spray_date,
         a.location_id, l.name,
         f.farmer_name, f.contact_no, f.village, f.crop, f.chemical_company,
         coalesce(nullif(btrim(f.pilot_name),''),'') as pilot,
         f.acre,
         coalesce(a.farmer_rate, l.farmer_rate, 0) as farmer_rate,
         coalesce(a.client_rate, l.client_rate, 0) as client_rate,
         round(f.acre * coalesce(a.farmer_rate, l.farmer_rate, 0), 2) as farmer_amount,
         round(f.acre * coalesce(a.client_rate, l.client_rate, 0), 2) as client_amount,
         round(f.acre * (coalesce(a.farmer_rate, l.farmer_rate, 0) + coalesce(a.client_rate, l.client_rate, 0)), 2) as amount,
         coalesce(f.gps_image_present, false) as gps,
         sdl.reason as short_reason,
         exists(select 1 from public.client_entry_issues ci
                 where ci.farmer_spray_id = f.id and ci.status <> 'closed') as open_issue
    from public.farmer_sprays f
    join lateral (
      select a.location_id, a.approval_status, a.farmer_rate, a.client_rate
        from public.acre_entries a
       where a.source_id = f.source_id
       order by a.id limit 1
    ) a on true
    join public.spray_locations l on l.id = a.location_id
    left join public.short_day_logs sdl
      on sdl.entry_date = f.spray_date and sdl.location_id = a.location_id
     and sdl.pilot_name = coalesce(nullif(btrim(f.pilot_name),''),'(unassigned)')
   where (select client_id from who) is not null
     and a.location_id in (select location_id from mine)
     and coalesce(a.approval_status,'approved') = 'approved'
     and (p_from is null or f.spray_date >= p_from)
     and (p_to   is null or f.spray_date <= p_to)
   order by f.spray_date desc, l.name;
$$;
grant execute on function public.client_spray_rows(date, date, uuid) to authenticated;

create or replace function public.client_export_rows(p_from date default null, p_to date default null)
returns table(
  spray_id bigint, source_id uuid, entry_date date, location_id uuid, location_name text,
  farmer_name text, farmer_phone text, village text, crop text, medicine text, pilot text,
  acres numeric, farmer_rate numeric, client_rate numeric,
  farmer_amount numeric, client_amount numeric, amount numeric, gps boolean,
  short_reason text, open_issue boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.my_client_can_export() then
    raise exception 'Downloads are not enabled for your account. Please contact DroCon Bharat.';
  end if;
  return query select * from public.client_spray_rows(p_from, p_to, null);
end $$;
grant execute on function public.client_export_rows(date, date) to authenticated;
