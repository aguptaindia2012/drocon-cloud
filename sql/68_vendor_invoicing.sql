-- ============================================================================
-- 68. Vendor & Pilot Portal — Phase 4: vendor rate card + vendor→DroCon invoicing
-- ----------------------------------------------------------------------------
-- DroCon sets the rate it PAYS a vendor, per (vendor, location, crop),
-- effective-dated. A vendor invoices DroCon for approved acres its pilots flew,
-- at those rates; DroCon approves → the invoice becomes a Payable. Acre rows are
-- stamped so nothing is vendor-invoiced twice. Runs ALONGSIDE the existing
-- FCR/commission partner invoicing. Additive / idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vendor payout rate card — per (vendor, location, crop), effective-dated.
--    crop_id NULL = all-crops default for that vendor+location.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_location_crop_rates (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete cascade,
  location_id   uuid not null references public.spray_locations(id) on delete cascade,
  crop_id       uuid references public.crops(id) on delete cascade,
  rate          numeric not null,               -- ₹/acre DroCon pays the vendor
  effective_from date not null default current_date,
  note          text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists vlcr_idx on public.vendor_location_crop_rates(vendor_id, location_id, effective_from);

alter table public.vendor_location_crop_rates enable row level security;
drop policy if exists vlcr_read on public.vendor_location_crop_rates;
create policy vlcr_read on public.vendor_location_crop_rates for select to authenticated
  using (public.is_internal() or vendor_id = public.my_vendor_id());
drop policy if exists vlcr_write on public.vendor_location_crop_rates;
create policy vlcr_write on public.vendor_location_crop_rates for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
grant select, insert, update, delete on public.vendor_location_crop_rates to authenticated;

-- rate in force for a vendor/location/crop on a date (crop-specific > all-crops)
create or replace function public.vendor_rate_on(p_vendor uuid, p_location uuid, p_crop uuid, p_date date)
returns numeric language sql stable set search_path = public as $$
  select r.rate from public.vendor_location_crop_rates r
   where r.vendor_id = p_vendor and r.location_id = p_location
     and (r.crop_id = p_crop or r.crop_id is null)
     and r.effective_from <= coalesce(p_date, current_date)
   order by (case when r.crop_id = p_crop then 0 else 1 end), r.effective_from desc
   limit 1;
$$;
grant execute on function public.vendor_rate_on(uuid, uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Stamp on acre_entries so an acre is vendor-invoiced only once.
-- ---------------------------------------------------------------------------
alter table public.acre_entries add column if not exists vendor_doc_id uuid;

-- ---------------------------------------------------------------------------
-- 3. Vendor invoices to DroCon.
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_invoices (
  id            uuid primary key default gen_random_uuid(),
  number        text,
  vendor_id     uuid not null references public.vendors(id),
  vendor_name   text,
  period_from   date,
  period_to     date,
  rows          jsonb not null default '[]',    -- [{entry_id,date,location,crop,acres,rate,amount}]
  acres         numeric not null default 0,
  amount        numeric not null default 0,
  status        text not null default 'submitted', -- submitted | approved | rejected
  reject_reason text,
  note          text,
  submitted_by  uuid references public.profiles(id),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  payable_id    uuid references public.payables(id),
  created_at    timestamptz not null default now()
);
create index if not exists vinv_vendor_idx on public.vendor_invoices(vendor_id, status);

alter table public.vendor_invoices enable row level security;
drop policy if exists vinv_read on public.vendor_invoices;
create policy vinv_read on public.vendor_invoices for select to authenticated
  using (public.is_internal() or vendor_id = public.my_vendor_id());
grant select, insert, update, delete on public.vendor_invoices to authenticated;
-- writes go through the RPCs below (security definer), so no write policy.

-- ---------------------------------------------------------------------------
-- 4. A vendor's approved, not-yet-vendor-invoiced acres with the DroCon rate.
--    Scoped to the caller's vendor. p_vendor lets internal preview a vendor.
-- ---------------------------------------------------------------------------
drop function if exists public.vendor_billable_acres(date, date, uuid);
create or replace function public.vendor_billable_acres(p_from date, p_to date, p_vendor uuid default null)
returns table(entry_id bigint, entry_date date, location_id uuid, location_name text,
              crop text, crop_id uuid, acres numeric, rate numeric, amount numeric)
language sql stable security definer set search_path = public as $$
  with v as (select case when public.is_internal() then p_vendor else public.my_vendor_id() end as vid)
  select a.id, a.entry_date, a.location_id, l.name,
         a.crop, a.crop_id, a.acres,
         public.vendor_rate_on((select vid from v), a.location_id, a.crop_id, a.entry_date) as rate,
         round(a.acres * coalesce(public.vendor_rate_on((select vid from v), a.location_id, a.crop_id, a.entry_date),0), 2) as amount
    from public.acre_entries a
    join public.pilots p on p.id = a.pilot_id
    join public.spray_locations l on l.id = a.location_id
   where p.vendor_id = (select vid from v)
     and a.vendor_doc_id is null
     and coalesce(a.acres,0) > 0
     and a.entry_date between coalesce(p_from,'2000-01-01') and coalesce(p_to, current_date)
   order by a.entry_date;
$$;
grant execute on function public.vendor_billable_acres(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Vendor generates an invoice from selected acre rows.
-- ---------------------------------------------------------------------------
drop function if exists public.generate_vendor_invoice(date, date, uuid[], text);
create or replace function public.generate_vendor_invoice(p_from date, p_to date, p_ids bigint[], p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_vendor uuid := public.my_vendor_id();
  vname text; rid uuid; seq int; fy text; jrows jsonb := '[]'::jsonb;
  tot_ac numeric := 0; tot_amt numeric := 0; rec record;
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

  fy := case when extract(month from current_date) >= 4
             then to_char(current_date,'YY')||'-'||to_char(current_date + interval '1 year','YY')
             else to_char(current_date - interval '1 year','YY')||'-'||to_char(current_date,'YY') end;
  select count(*)+1 into seq from public.vendor_invoices where vendor_id = v_vendor;

  insert into public.vendor_invoices(number, vendor_id, vendor_name, period_from, period_to, rows, acres, amount, status, note, submitted_by)
    values ('VINV/'||fy||'/'||lpad(seq::text,3,'0'), v_vendor, vname, p_from, p_to, jrows, tot_ac, tot_amt, 'submitted', p_note, auth.uid())
    returning id into rid;

  update public.acre_entries set vendor_doc_id = rid
   where id = any(p_ids) and vendor_doc_id is null
     and pilot_id in (select id from public.pilots where vendor_id = v_vendor);
  return rid;
end $$;
grant execute on function public.generate_vendor_invoice(date, date, bigint[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. DroCon approve → create a Payable; or reject → release the acre rows.
-- ---------------------------------------------------------------------------
create or replace function public.approve_vendor_invoice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.vendor_invoices%rowtype; pid uuid;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select * into r from public.vendor_invoices where id = p_id;
  if r.id is null then raise exception 'Invoice not found'; end if;
  if r.status <> 'submitted' then raise exception 'Already processed'; end if;

  insert into public.payables(vendor_id, vendor_invoice_no, invoice_date, amount, gst_amount, total,
                              category, note, status, approval_status, created_by)
    values (r.vendor_id, r.number, current_date, r.amount, 0, r.amount,
            'Aerial spraying — vendor', 'Vendor acre invoice '||coalesce(r.number,''), 'unpaid', 'approved', auth.uid())
    returning id into pid;

  update public.vendor_invoices set status='approved', approved_by=auth.uid(), approved_at=now(), payable_id=pid where id = p_id;
end $$;
grant execute on function public.approve_vendor_invoice(uuid) to authenticated;

create or replace function public.reject_vendor_invoice(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.vendor_invoices%rowtype;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select * into r from public.vendor_invoices where id = p_id;
  if r.id is null then raise exception 'Invoice not found'; end if;
  if r.status <> 'submitted' then raise exception 'Already processed'; end if;
  update public.acre_entries set vendor_doc_id = null where vendor_doc_id = p_id;  -- release rows
  update public.vendor_invoices set status='rejected', reject_reason=p_reason where id = p_id;
end $$;
grant execute on function public.reject_vendor_invoice(uuid, text) to authenticated;
