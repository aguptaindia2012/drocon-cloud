-- ============================================================================
-- 109. Idle-location alert respects inactive pilots / closed assignments
-- ----------------------------------------------------------------------------
-- v_idle_active_locations counted any location with an active pilot_assignment,
-- even if that pilot is now marked inactive. Require the assignment's pilot to
-- be active too, so a location whose pilots are all inactive no longer flags.
-- (v_idle_active_pilots already filters pilots.is_active, so it's unchanged.)
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
        join public.pilots p on p.id = pa.pilot_id
       where pa.location_id = l.id
         and coalesce(pa.status,'active') = 'active'
         and coalesce(p.is_active, true) = true
    ) asg on true
    left join public.clients c on c.id = l.client_id
    left join lateral (
      select max(a.entry_date) as last_spray
        from public.acre_entries a
       where a.location_id = l.id and coalesce(a.approval_status,'approved') = 'approved'
    ) ls on true
   where asg.active_pilots > 0;
grant select on public.v_idle_active_locations to authenticated;
