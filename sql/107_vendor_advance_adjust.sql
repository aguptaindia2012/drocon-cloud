-- ============================================================================
-- 107. Vendor invoice: adjust against an advance (acres still billed)
-- ----------------------------------------------------------------------------
-- When generating an invoice the vendor may net part of it against an OPEN
-- advance they took. The acres are still stamped as billed; the net payable to
-- the vendor is reduced by the adjustment; on approval a repayment settlement
-- reduces the advance (and settles it when fully repaid).
-- ============================================================================
alter table public.vendor_invoices add column if not exists advance_id     uuid references public.advances(id);
alter table public.vendor_invoices add column if not exists advance_adjust numeric not null default 0;
alter table public.vendor_invoices add column if not exists net_amount     numeric;

-- The vendor's open advances with remaining outstanding (for the invoice screen).
create or replace function public.my_vendor_advances(p_vendor uuid default null)
returns table(id uuid, issued_on date, amount numeric, outstanding numeric, purpose text)
language sql stable security definer set search_path = public as $$
  with v as (select case when public.is_internal() and p_vendor is not null then p_vendor else public.my_vendor_id() end as vid)
  select a.id, a.issued_on, a.amount, round(a.amount - coalesce(s.settled,0),2) as outstanding, a.purpose
    from public.advances a
    left join (select advance_id, sum(amount) settled from public.advance_settlements group by advance_id) s on s.advance_id=a.id
   where a.vendor_id = (select vid from v) and a.status='open'
     and (a.amount - coalesce(s.settled,0)) > 0.01
   order by a.issued_on;
$$;
grant execute on function public.my_vendor_advances(uuid) to authenticated;

-- Recreate generate_vendor_invoice with the optional advance adjustment.
drop function if exists public.generate_vendor_invoice(date, date, bigint[], text);
drop function if exists public.generate_vendor_invoice(date, date, bigint[], text, uuid, numeric);
create or replace function public.generate_vendor_invoice(
  p_from date, p_to date, p_ids bigint[], p_note text default null,
  p_advance_id uuid default null, p_adjust numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_vendor uuid := public.my_vendor_id();
  vname text; rid uuid; seq int; fy text; jrows jsonb := '[]'::jsonb;
  tot_ac numeric := 0; tot_amt numeric := 0; rec record; adj numeric := coalesce(p_adjust,0); outst numeric;
begin
  if v_vendor is null then raise exception 'Only a vendor login can generate an invoice'; end if;
  if p_ids is null or array_length(p_ids,1) is null then raise exception 'Select at least one row'; end if;
  select coalesce(firm_name, name) into vname from public.vendors where id = v_vendor;

  for rec in
    select a.id, a.entry_date, l.name as loc, a.crop, a.acres,
           public.vendor_rate_on(v_vendor, a.location_id, a.crop_id, a.entry_date) as rate
      from public.acre_entries a
      join public.pilots p on p.id = a.pilot_id
      join public.spray_locations l on l.id = a.location_id
     where a.id = any(p_ids) and p.vendor_id = v_vendor and a.vendor_doc_id is null and coalesce(a.acres,0) > 0
  loop
    jrows := jrows || jsonb_build_object('entry_id',rec.id,'date',rec.entry_date,'location',rec.loc,
              'crop',rec.crop,'acres',rec.acres,'rate',coalesce(rec.rate,0),
              'amount',round(rec.acres*coalesce(rec.rate,0),2));
    tot_ac := tot_ac + rec.acres; tot_amt := tot_amt + round(rec.acres*coalesce(rec.rate,0),2);
  end loop;
  if jsonb_array_length(jrows) = 0 then raise exception 'None of the selected rows are billable'; end if;

  if p_advance_id is not null and adj > 0 then
    select round(a.amount - coalesce(s.settled,0),2) into outst
      from public.advances a
      left join (select advance_id, sum(amount) settled from public.advance_settlements group by advance_id) s on s.advance_id=a.id
     where a.id = p_advance_id and a.vendor_id = v_vendor and a.status='open';
    if outst is null then raise exception 'Advance not found or not open'; end if;
    if adj > outst then raise exception 'Adjustment (%) exceeds the advance outstanding (%)', adj, outst; end if;
    if adj > tot_amt then raise exception 'Adjustment cannot exceed the invoice amount'; end if;
  else
    adj := 0; p_advance_id := null;
  end if;

  fy := case when extract(month from current_date) >= 4
             then to_char(current_date,'YY')||'-'||to_char(current_date + interval '1 year','YY')
             else to_char(current_date - interval '1 year','YY')||'-'||to_char(current_date,'YY') end;
  select count(*)+1 into seq from public.vendor_invoices where vendor_id = v_vendor;

  insert into public.vendor_invoices(number, vendor_id, vendor_name, period_from, period_to, rows, acres, amount,
                                     advance_id, advance_adjust, net_amount, status, note, submitted_by)
    values ('VINV/'||fy||'/'||lpad(seq::text,3,'0'), v_vendor, vname, p_from, p_to, jrows, tot_ac, tot_amt,
            p_advance_id, adj, tot_amt - adj, 'submitted', p_note, auth.uid())
    returning id into rid;

  update public.acre_entries set vendor_doc_id = rid
   where id = any(p_ids) and vendor_doc_id is null
     and pilot_id in (select id from public.pilots where vendor_id = v_vendor);
  return rid;
end $$;
grant execute on function public.generate_vendor_invoice(date, date, bigint[], text, uuid, numeric) to authenticated;

-- Approve → Payable at the NET amount; settle the advance by the adjustment.
create or replace function public.approve_vendor_invoice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.vendor_invoices%rowtype; pid uuid; net numeric; outst numeric;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select * into r from public.vendor_invoices where id = p_id;
  if r.id is null then raise exception 'Invoice not found'; end if;
  if r.status <> 'submitted' then raise exception 'Already processed'; end if;
  net := r.amount - coalesce(r.advance_adjust,0);

  insert into public.payables(vendor_id, vendor_invoice_no, invoice_date, amount, gst_amount, total,
                              category, note, status, approval_status, created_by)
    values (r.vendor_id, r.number, current_date, net, 0, net,
            'Aerial spraying — vendor',
            'Vendor acre invoice '||coalesce(r.number,'')||case when coalesce(r.advance_adjust,0)>0 then ' (net of advance ₹'||r.advance_adjust||')' else '' end,
            'unpaid', 'approved', auth.uid())
    returning id into pid;

  if r.advance_id is not null and coalesce(r.advance_adjust,0) > 0 then
    insert into public.advance_settlements(advance_id, kind, ref_id, amount, note, created_by)
      values (r.advance_id, 'repayment', r.number, r.advance_adjust, 'Adjusted against vendor invoice', auth.uid());
    select round(a.amount - coalesce(s.settled,0),2) into outst
      from public.advances a
      left join (select advance_id, sum(amount) settled from public.advance_settlements group by advance_id) s on s.advance_id=a.id
     where a.id = r.advance_id;
    if coalesce(outst,0) <= 0.01 then update public.advances set status='settled' where id = r.advance_id; end if;
  end if;

  update public.vendor_invoices set status='approved', approved_by=auth.uid(), approved_at=now(), payable_id=pid where id = p_id;
end $$;
grant execute on function public.approve_vendor_invoice(uuid) to authenticated;

-- my_vendor_invoices: include the advance adjustment + net.
drop function if exists public.my_vendor_invoices(uuid);
create or replace function public.my_vendor_invoices(p_vendor uuid default null)
returns table(id uuid, number text, period_from date, period_to date, acres numeric, amount numeric,
              advance_adjust numeric, net_amount numeric, status text, pay_status text, reject_reason text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with v as (select case when public.is_internal() and p_vendor is not null then p_vendor else public.my_vendor_id() end as vid)
  select i.id, i.number, i.period_from, i.period_to, i.acres, i.amount,
         coalesce(i.advance_adjust,0), coalesce(i.net_amount, i.amount),
         i.status, pay.status as pay_status, i.reject_reason, i.created_at
    from public.vendor_invoices i
    left join public.payables pay on pay.id = i.payable_id
   where i.vendor_id = (select vid from v)
   order by i.created_at desc;
$$;
grant execute on function public.my_vendor_invoices(uuid) to authenticated;
