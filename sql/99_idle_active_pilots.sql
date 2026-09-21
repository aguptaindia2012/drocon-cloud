-- ============================================================================
-- 99. Active pilots with no recent spray (for the Acre dashboard)
-- ----------------------------------------------------------------------------
-- Lists pilots marked ACTIVE in the registers (pilots.is_active) that hold an
-- active assignment, with their last approved spray date and idle-day count, so
-- the team can spot idle pilots and update their active status in the registers.
-- Matches spray rows by pilot_id OR pilot name (legacy denormalised rows).
-- A plain view: it runs with the caller's RLS, so only internal users see rows.
-- ============================================================================
create or replace view public.v_idle_active_pilots as
  select p.id as pilot_id, p.name as pilot_name,
         coalesce(v.firm_name, v.name) as vendor_name,
         l.name as location_name,
         pa.start_date,
         ls.last_spray,
         (current_date - coalesce(ls.last_spray, pa.start_date)) as idle_days
    from public.pilots p
    join public.pilot_assignments pa
      on pa.pilot_id = p.id and coalesce(pa.status,'active') = 'active'
    join public.spray_locations l on l.id = pa.location_id
    left join public.vendors v on v.id = p.vendor_id
    left join lateral (
      select max(a.entry_date) as last_spray
        from public.acre_entries a
       where (a.pilot_id = p.id or lower(btrim(a.pilot_name)) = lower(btrim(p.name)))
         and coalesce(a.approval_status,'approved') = 'approved'
    ) ls on true
   where coalesce(p.is_active, true) = true;
grant select on public.v_idle_active_pilots to authenticated;
