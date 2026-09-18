-- ============================================================================
-- 96. Short-day 'active' flag + client active assignments (for the grid)
-- ----------------------------------------------------------------------------
-- - short_days() gains an `active` column = the location currently has an active
--   pilot assignment (so the screens can offer an "active only" toggle).
-- - client_active_assignments(): the active location↔pilot pairs for the caller's
--   client, so the dashboard grid can list every active location & pilot even
--   when they sprayed nothing this week.
-- Recreates short_days() (return type changes). Additive otherwise.
-- ============================================================================

drop function if exists public.short_days(text, date, date);

create or replace function public.short_days(p_scope text default 'internal', p_from date default null, p_to date default null)
returns table(entry_date date, location_id uuid, location_name text, pilot_name text, acres numeric, reason text, log_id uuid, active boolean)
language sql stable security definer set search_path = public as $$
  with scope as (
    select case
      when p_scope='client' then (public.my_client_id() is not null)
      when p_scope='vendor' then (public.my_vendor_id() is not null)
      else public.is_internal() end as ok
  ), agg as (
    select a.entry_date, a.location_id, l.name as location_name,
           coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)') as pilot_name,
           round(sum(a.acres),2) as acres
      from public.acre_entries a
      join public.spray_locations l on l.id = a.location_id
      left join public.pilots p on p.id = a.pilot_id
     where coalesce(a.approval_status,'approved') = 'approved'
       and (select ok from scope)
       and (p_scope='internal'
            or (p_scope='client' and a.location_id in (select cl.location_id from public.client_locations cl where cl.client_id = public.my_client_id()))
            or (p_scope='vendor' and a.location_id in (select public.my_vendor_location_ids())))
       and a.entry_date >= coalesce(p_from, current_date - 45)
       and (p_to is null or a.entry_date <= p_to)
     group by a.entry_date, a.location_id, l.name,
              coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)')
    having round(sum(a.acres),2) < 12
  )
  select agg.entry_date, agg.location_id, agg.location_name, agg.pilot_name, agg.acres,
         sdl.reason, sdl.id,
         exists(select 1 from public.pilot_assignments pa
                 where pa.location_id = agg.location_id and coalesce(pa.status,'active')='active') as active
    from agg
    left join public.short_day_logs sdl
      on sdl.entry_date = agg.entry_date and sdl.location_id = agg.location_id and sdl.pilot_name = agg.pilot_name
   order by agg.entry_date desc, agg.location_name, agg.pilot_name;
$$;
grant execute on function public.short_days(text, date, date) to authenticated;

-- Active location↔pilot pairs for the current client (for the dashboard grid).
create or replace function public.client_active_assignments()
returns table(location_id uuid, location_name text, pilot_name text)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, p.name
    from public.pilot_assignments pa
    join public.pilots p on p.id = pa.pilot_id
    join public.spray_locations l on l.id = pa.location_id
   where coalesce(pa.status,'active') = 'active'
     and l.id in (select cl.location_id from public.client_locations cl where cl.client_id = public.my_client_id())
   order by l.name, p.name;
$$;
grant execute on function public.client_active_assignments() to authenticated;
