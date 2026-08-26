-- ============================================================================
-- 76. Server-side acre summaries (fixes undercounting on the Acre Tracker)
-- ----------------------------------------------------------------------------
-- The dashboard used to pull every acre_entries row to the browser (.limit(20000)
-- with no order) and sum client-side — so once the table grew past the row cap,
-- an arbitrary subset came back and daily/monthly/total acres were undercounted.
-- Aggregate in the DB instead, so totals are always complete. Additive.
-- ============================================================================

-- billed = the row is on a farmer/client invoice, or marked billed-outside-app
create or replace view public.v_acre_monthly as
  select to_char(a.entry_date,'YYYY-MM') as ym,
         round(sum(a.acres),2)  as acres,
         round(sum(a.amount),2) as revenue,
         round(sum(a.acres) filter (where a.farmer_doc_id is not null or a.client_doc_id is not null
                    or coalesce(a.farmer_billed_override,false) or coalesce(a.client_billed_override,false)),2) as billed_acres
    from public.acre_entries a
   group by 1;
grant select on public.v_acre_monthly to authenticated;

create or replace view public.v_acre_by_location as
  select coalesce(l.name,'(none)') as location, l.state,
         round(sum(a.acres),2)  as acres,
         round(sum(a.amount),2) as revenue
    from public.acre_entries a
    left join public.spray_locations l on l.id = a.location_id
   group by coalesce(l.name,'(none)'), l.state;
grant select on public.v_acre_by_location to authenticated;

-- recent per location+pilot+day (last 40 days) for the 7-day grid & short-day
-- analysis — pre-aggregated so the underlying row volume can't truncate it.
create or replace view public.v_acre_pilot_recent as
  select a.entry_date,
         coalesce(l.name,'(none)') as location, l.state,
         coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)') as pilot,
         round(sum(a.acres),2) as acres
    from public.acre_entries a
    left join public.spray_locations l on l.id = a.location_id
    left join public.pilots p on p.id = a.pilot_id
   where a.entry_date >= current_date - 40
   group by a.entry_date, coalesce(l.name,'(none)'), l.state,
            coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)');
grant select on public.v_acre_pilot_recent to authenticated;
