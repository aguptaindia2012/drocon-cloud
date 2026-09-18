-- ============================================================================
-- 97. Client location summary — deployment metrics per assigned location
-- ----------------------------------------------------------------------------
-- For each of the client's assigned locations:
--   start_date    = first approved spray date
--   deactivated_on= when the location's assignment was closed (null if active)
--   active        = has a currently-active pilot assignment
--   days_deployed = (deactivated_on or today) - start_date + 1
--   acres         = total approved acres
--   avg_daily     = acres / days_deployed
-- Security-definer, scoped to my_client_id() (p_client lets internal preview).
-- ============================================================================
create or replace function public.client_location_summary(p_client uuid default null)
returns table(location_id uuid, location_name text, start_date date, last_spray date,
              deactivated_on date, active boolean, days_deployed int, acres numeric, avg_daily numeric)
language sql stable security definer set search_path = public as $$
  with who as (
    select case when public.is_internal() and p_client is not null then p_client else public.my_client_id() end as cid
  ), mine as (
    select cl.location_id from public.client_locations cl, who where cl.client_id = who.cid
  ), sp as (
    select a.location_id, min(a.entry_date) as start_date, max(a.entry_date) as last_spray, round(sum(a.acres),2) as acres
      from public.acre_entries a
     where coalesce(a.approval_status,'approved')='approved'
       and a.location_id in (select location_id from mine)
     group by a.location_id
  ), asg as (
    select pa.location_id,
           bool_or(coalesce(pa.status,'active')='active') as active,
           max(case when coalesce(pa.status,'active') <> 'active' then coalesce(pa.closed_at::date, pa.end_date) end) as deactivated_on
      from public.pilot_assignments pa
     where pa.location_id in (select location_id from mine)
     group by pa.location_id
  )
  select l.id, l.name, sp.start_date, sp.last_spray,
         case when coalesce(asg.active,false) then null else asg.deactivated_on end as deactivated_on,
         coalesce(asg.active,false) as active,
         case when sp.start_date is null then null
              else (coalesce(case when coalesce(asg.active,false) then null else asg.deactivated_on end, current_date) - sp.start_date) + 1 end as days_deployed,
         coalesce(sp.acres,0) as acres,
         case when sp.start_date is null then null
              else round(coalesce(sp.acres,0)
                   / nullif((coalesce(case when coalesce(asg.active,false) then null else asg.deactivated_on end, current_date) - sp.start_date) + 1, 0), 2) end as avg_daily
    from public.spray_locations l
    join mine on mine.location_id = l.id
    left join sp  on sp.location_id  = l.id
    left join asg on asg.location_id = l.id
   where (select cid from who) is not null
   order by coalesce(sp.acres,0) desc;
$$;
grant execute on function public.client_location_summary(uuid) to authenticated;
