-- ============================================================================
-- 38. Vendor acreage report + auto-numbering series
-- ----------------------------------------------------------------------------
-- (1) v_vendor_acreage — every acre row resolved to the VENDOR who employs the
--     pilot, so a period statement can be shared with the vendor to reconcile
--     against their own billing before we invoice the client.
--     NOTE: this resolves through acre_entries.pilot_id, so it covers work
--     entered after the Pilots master went live. Older rows that only carry a
--     text pilot_name have no vendor to attribute to and are excluded.
-- (3) Auto-numbering: client codes + agreement numbers, alongside the existing
--     next_doc_seq() used by invoices / quotations / POs / credit notes.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- --------------------------------------------------- VENDOR ACREAGE ------
create or replace view public.v_vendor_acreage as
  select v.id                                   as vendor_id,
         coalesce(v.firm_name, v.name)          as vendor_name,
         p.id                                   as pilot_id,
         p.name                                 as pilot_name,
         p.phone                                as pilot_phone,
         a.id                                   as acre_id,
         a.entry_date,
         a.location_id,
         l.name                                 as location_name,
         cl.firm_name                           as client_name,
         a.acres,
         a.crop, a.chemical,
         coalesce(a.farmer_rate, l.farmer_rate, 0) as farmer_rate,
         coalesce(a.client_rate, l.client_rate, 0) as client_rate,
         round(a.acres * coalesce(a.farmer_rate, l.farmer_rate, 0), 2) as farmer_amount,
         round(a.acres * coalesce(a.client_rate, l.client_rate, 0), 2) as client_amount,
         round(a.acres * (coalesce(a.farmer_rate, l.farmer_rate, 0)
                        + coalesce(a.client_rate, l.client_rate, 0)), 2) as total_amount,
         a.farmer_doc_id, a.client_doc_id,
         (a.farmer_doc_id is not null) as farmer_billed,
         (a.client_doc_id is not null) as client_billed
    from public.acre_entries a
    join public.pilots  p  on p.id  = a.pilot_id
    join public.vendors v  on v.id  = p.vendor_id
    left join public.spray_locations l on l.id = a.location_id
    left join public.clients cl        on cl.id = l.client_id;
grant select on public.v_vendor_acreage to authenticated;

-- ------------------------------------------------------ NUMBER SERIES ----
-- Client code, e.g. DCB/CL/0007
alter table public.clients add column if not exists client_code text;
create unique index if not exists clients_code_uidx
  on public.clients (client_code) where client_code is not null;

create or replace function public.next_client_code()
returns text language sql stable security definer set search_path = public as $$
  select 'DCB/CL/' || lpad((
    coalesce(max(nullif(regexp_replace(client_code, '^.*/', ''), ''))::int, 0) + 1
  )::text, 4, '0')
  from public.clients
  where client_code ~ '^DCB/CL/[0-9]+$';
$$;

-- Agreement / contract number, e.g. DCB/AGR/26-27/0004
create or replace function public.next_agreement_no(p_fy text)
returns text language sql stable security definer set search_path = public as $$
  select 'DCB/AGR/' || p_fy || '/' || lpad((
    coalesce(max(nullif(regexp_replace(agreement_no, '^.*/', ''), ''))::int, 0) + 1
  )::text, 4, '0')
  from public.agreements
  where agreement_no like 'DCB/AGR/' || p_fy || '/%'
    and agreement_no ~ '[0-9]+$';
$$;

grant execute on function public.next_client_code()        to authenticated;
grant execute on function public.next_agreement_no(text)   to authenticated;
