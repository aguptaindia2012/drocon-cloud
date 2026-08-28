-- ============================================================================
-- 77. Location × Month × Pilot acre summary (expandable Location-wise totals)
-- ----------------------------------------------------------------------------
-- Pre-aggregated so the Location-wise table can expand: Location → Month →
-- Pilot, each with acres & revenue, without the browser ever pulling raw rows.
-- Additive.
-- ============================================================================

create or replace view public.v_acre_loc_month_pilot as
  select coalesce(l.name,'(none)') as location,
         to_char(a.entry_date,'YYYY-MM') as ym,
         coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)') as pilot,
         round(sum(a.acres),2)  as acres,
         round(sum(a.amount),2) as revenue
    from public.acre_entries a
    left join public.spray_locations l on l.id = a.location_id
    left join public.pilots p on p.id = a.pilot_id
   group by coalesce(l.name,'(none)'), to_char(a.entry_date,'YYYY-MM'),
            coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)');
grant select on public.v_acre_loc_month_pilot to authenticated;
