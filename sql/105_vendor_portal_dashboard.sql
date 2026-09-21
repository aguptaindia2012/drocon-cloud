-- ============================================================================
-- 105. Vendor Portal — acre dashboard feeds + billing summary + invoice status
-- ----------------------------------------------------------------------------
-- Scoped to the vendor's own pilots' approved acres (pilots.vendor_id).
-- Internal callers can preview a vendor by passing p_vendor.
-- ============================================================================

-- The vendor's locations (names) — vendors can't read spray_locations directly.
create or replace function public.my_vendor_locations()
returns table(id uuid, name text, state text, district text)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.state, l.district
    from public.spray_locations l
   where l.id in (select public.my_vendor_location_ids())
   order by l.name;
$$;
grant execute on function public.my_vendor_locations() to authenticated;

-- Approved acre rows for the vendor's pilots (for the dashboard grid / drill).
create or replace function public.vendor_acre_rows(p_from date default null, p_to date default null, p_vendor uuid default null)
returns table(entry_date date, location_id uuid, location_name text, pilot_name text, crop text, acres numeric, billed boolean)
language sql stable security definer set search_path = public as $$
  with v as (select case when public.is_internal() and p_vendor is not null then p_vendor else public.my_vendor_id() end as vid)
  select a.entry_date, a.location_id, l.name,
         coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)') as pilot_name,
         a.crop, a.acres, (a.vendor_doc_id is not null) as billed
    from public.acre_entries a
    join public.pilots p on p.id = a.pilot_id
    join public.spray_locations l on l.id = a.location_id
   where p.vendor_id = (select vid from v)
     and coalesce(a.approval_status,'approved') = 'approved'
     and coalesce(a.acres,0) > 0
     and (p_from is null or a.entry_date >= p_from)
     and (p_to   is null or a.entry_date <= p_to)
   order by a.entry_date desc, l.name;
$$;
grant execute on function public.vendor_acre_rows(date, date, uuid) to authenticated;

-- Per-location deployment summary for the vendor (start / deactivation / days / avg).
create or replace function public.vendor_location_summary(p_vendor uuid default null)
returns table(location_id uuid, location_name text, start_date date, last_spray date,
              deactivated_on date, active boolean, days_deployed int, acres numeric, avg_daily numeric)
language sql stable security definer set search_path = public as $$
  with v as (select case when public.is_internal() and p_vendor is not null then p_vendor else public.my_vendor_id() end as vid),
  locs as (
    select distinct a.location_id
      from public.acre_entries a join public.pilots p on p.id=a.pilot_id
     where p.vendor_id=(select vid from v)
  ), sp as (
    select a.location_id, min(a.entry_date) start_date, max(a.entry_date) last_spray, round(sum(a.acres),2) acres
      from public.acre_entries a join public.pilots p on p.id=a.pilot_id
     where p.vendor_id=(select vid from v) and coalesce(a.approval_status,'approved')='approved'
     group by a.location_id
  ), asg as (
    select pa.location_id, bool_or(coalesce(pa.status,'active')='active') active,
           max(case when coalesce(pa.status,'active')<>'active' then coalesce(pa.closed_at::date, pa.end_date) end) deactivated_on
      from public.pilot_assignments pa join public.pilots p on p.id=pa.pilot_id
     where p.vendor_id=(select vid from v)
     group by pa.location_id
  )
  select l.id, l.name, sp.start_date, sp.last_spray,
         case when coalesce(asg.active,false) then null else asg.deactivated_on end,
         coalesce(asg.active,false),
         case when sp.start_date is null then null else (coalesce(case when coalesce(asg.active,false) then null else asg.deactivated_on end, current_date) - sp.start_date)+1 end,
         coalesce(sp.acres,0),
         case when sp.start_date is null then null else round(coalesce(sp.acres,0)/nullif((coalesce(case when coalesce(asg.active,false) then null else asg.deactivated_on end, current_date) - sp.start_date)+1,0),2) end
    from public.spray_locations l
    join locs on locs.location_id=l.id
    left join sp on sp.location_id=l.id
    left join asg on asg.location_id=l.id
   where (select vid from v) is not null
   order by coalesce(sp.acres,0) desc;
$$;
grant execute on function public.vendor_location_summary(uuid) to authenticated;

-- Vendor billing summary: unbilled acres/amount, pending payment, amount due to DroCon.
create or replace function public.my_vendor_billing(p_vendor uuid default null)
returns table(unbilled_acres numeric, unbilled_amount numeric, pending_payment numeric, due_to_drocon numeric)
language sql stable security definer set search_path = public as $$
  with v as (select case when public.is_internal() and p_vendor is not null then p_vendor else public.my_vendor_id() end as vid)
  select
    coalesce((select round(sum(a.acres),2) from public.acre_entries a join public.pilots p on p.id=a.pilot_id
               where p.vendor_id=(select vid from v) and coalesce(a.approval_status,'approved')='approved' and a.vendor_doc_id is null),0),
    coalesce((select round(sum(amount),2) from public.vendor_billable_acres(null,null,(select vid from v))),0),
    coalesce((select round(sum(p.total),2) from public.payables p where p.vendor_id=(select vid from v) and p.status <> 'paid'),0),
    coalesce((select round(sum(a.amount - coalesce(s.settled,0)),2)
                from public.advances a
                left join (select advance_id, sum(amount) settled from public.advance_settlements group by advance_id) s on s.advance_id=a.id
               where a.vendor_id=(select vid from v) and a.status='open'),0);
$$;
grant execute on function public.my_vendor_billing(uuid) to authenticated;

-- The vendor's own invoices with the live payment status from the payable.
create or replace function public.my_vendor_invoices(p_vendor uuid default null)
returns table(id uuid, number text, period_from date, period_to date, acres numeric, amount numeric,
              status text, pay_status text, reject_reason text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with v as (select case when public.is_internal() and p_vendor is not null then p_vendor else public.my_vendor_id() end as vid)
  select i.id, i.number, i.period_from, i.period_to, i.acres, i.amount,
         i.status, pay.status as pay_status, i.reject_reason, i.created_at
    from public.vendor_invoices i
    left join public.payables pay on pay.id = i.payable_id
   where i.vendor_id = (select vid from v)
   order by i.created_at desc;
$$;
grant execute on function public.my_vendor_invoices(uuid) to authenticated;
