-- ============================================================================
-- 100. Active locations with no recent work (for the Acre dashboard)
-- ----------------------------------------------------------------------------
-- Locations that are ACTIVE (have at least one active pilot assignment) but have
-- had no approved spray in the last few days — so the team can chase them or
-- close the location. Includes the client, active pilot count, last spray and
-- idle-day count. Plain view: runs with the caller's RLS (internal only).
-- ============================================================================
create or replace view public.v_idle_active_locations as
  select l.id as location_id, l.name as location_name, l.district, l.state,
         coalesce(c.firm_name, c.name) as client_name,
         asg.active_pilots,
         ls.last_spray,
         (current_date - coalesce(ls.last_spray, asg.first_start)) as idle_days
    from public.spray_locations l
    join lateral (
      select count(*) as active_pilots, min(pa.start_date) as first_start
        from public.pilot_assignments pa
       where pa.location_id = l.id and coalesce(pa.status,'active') = 'active'
    ) asg on true
    left join public.clients c on c.id = l.client_id
    left join lateral (
      select max(a.entry_date) as last_spray
        from public.acre_entries a
       where a.location_id = l.id and coalesce(a.approval_status,'approved') = 'approved'
    ) ls on true
   where asg.active_pilots > 0;
grant select on public.v_idle_active_locations to authenticated;
