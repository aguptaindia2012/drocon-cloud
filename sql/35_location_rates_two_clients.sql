-- ============================================================================
-- 35. Locations carry BOTH rates and BOTH billing parties; entry is
--     location-first and carries the selected pilot.
-- ----------------------------------------------------------------------------
-- A location now holds:
--   farmer_rate   -> billed to farmer_bill_to  (0% GST, "Bill of Supply")
--   client_rate   -> billed to client_bill_to  (18% GST, Marketing Expense /
--                    Subsidy per that client's label). May be 0 — then no
--                    client-side bill is raised at all.
-- Acre data is captured against the LOCATION; invoicing filters location first,
-- then the client, because one location can bill two different clients.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- ------------------------------------------------------- LOCATION RATES ---
alter table public.spray_locations add column if not exists farmer_rate    numeric;
alter table public.spray_locations add column if not exists client_rate    numeric not null default 0;
alter table public.spray_locations add column if not exists farmer_bill_to uuid references public.clients(id);
alter table public.spray_locations add column if not exists client_bill_to uuid references public.clients(id);

-- Carry the old single default rate over as the farmer rate (once).
update public.spray_locations
   set farmer_rate = nullif(rates->>'default','')::numeric
 where farmer_rate is null
   and coalesce(rates->>'default','') <> '';

-- Default the farmer billing party to the location's existing client.
update public.spray_locations
   set farmer_bill_to = client_id
 where farmer_bill_to is null and client_id is not null;

-- A client-rate component must name who gets billed for it.
alter table public.spray_locations drop constraint if exists loc_client_rate_party_chk;
alter table public.spray_locations add constraint loc_client_rate_party_chk
  check (coalesce(client_rate,0) = 0 or client_bill_to is not null);

-- --------------------------------------------- ENTRY IS LOCATION-FIRST ----
alter table public.daily_submissions add column if not exists location_id uuid references public.spray_locations(id);

-- ---------------------------------------------------- POST THE DAY -------
-- Now resolves the location by ID (falling back to the old name lookup for
-- historic rows) and carries pilot_id through to acre_entries.
create or replace function public.post_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     public.daily_submissions%rowtype;
  r     jsonb;
  loc   uuid;
  sid   uuid;
  acres numeric; cr numeric; fr numeric; amt numeric; pid uuid;
  sids  text[] := array[]::text[];
begin
  select * into s from public.daily_submissions where id = p_id;
  if s.id is null then raise exception 'Submission not found'; end if;
  if s.posted then raise exception 'This submission is already posted'; end if;

  if not (public.has_role(array['admin','approver']::user_role[])
          or s.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to approve this daily submission';
  end if;

  -- prefer the chosen location; fall back to name for older submissions
  loc := s.location_id;
  if loc is null then
    select id into loc from public.spray_locations where lower(name) = lower(s.location_name) limit 1;
    if loc is null then
      insert into public.spray_locations(name, state, district, rates)
        values (s.location_name, s.state, s.district, '{}'::jsonb) returning id into loc;
    end if;
  end if;

  for r in select * from jsonb_array_elements(s.rows) loop
    acres := coalesce(nullif(r->>'acres','')::numeric, 0);
    cr    := coalesce(nullif(r->>'crate','')::numeric, 0);
    fr    := coalesce(nullif(r->>'frate','')::numeric, 0);
    pid   := nullif(r->>'pilot_id','')::uuid;
    if acres = 0 and coalesce(trim(r->>'farmer'),'') = '' then continue; end if;
    amt := acres * (cr + fr);
    sid := gen_random_uuid();
    sids := array_append(sids, sid::text);

    insert into public.acre_entries
      (entry_date, location_id, pilot_id, pilot_name, acres, rate, client_rate, farmer_rate,
       amount, crop, chemical, source_id, created_by)
    values
      (s.entry_date, loc, pid, nullif(r->>'pilot',''), acres, nullif(cr+fr,0), nullif(cr,0), nullif(fr,0),
       nullif(amt,0), nullif(r->>'crop',''), nullif(r->>'chemical',''), sid, s.submitted_by);

    insert into public.farmer_sprays
      (spray_date, pilot_name, client_name, farmer_name, contact_no, village, state, district,
       chemical_company, crop, acre, rate, amount, gps_image_present, source_id, created_by)
    values
      (s.entry_date, nullif(r->>'pilot',''), s.client_name, nullif(r->>'farmer',''), nullif(r->>'phone',''),
       nullif(r->>'village',''), s.state, s.district, nullif(r->>'chemical',''), nullif(r->>'crop',''),
       nullif(acres,0), nullif(cr+fr,0), nullif(amt,0), coalesce((r->>'gps')::boolean,false), sid, s.submitted_by);
  end loop;

  update public.daily_submissions
     set approval_status='approved', approved_by=auth.uid(), approved_at=now(),
         posted=true, posted_source_ids=sids, updated_at=now()
   where id = p_id;
end $$;

-- ------------------------------------------- BILLABLE ACRE WORK VIEW ------
-- One row per acre entry with BOTH billing sides resolved, so invoicing can
-- filter by location first and then by client.
create or replace view public.v_acre_billing as
  select a.id, a.entry_date, a.acres, a.crop, a.chemical,
         a.location_id, l.name as location_name, l.state, l.district,
         a.pilot_id, coalesce(p.name, a.pilot_name) as pilot_name,
         coalesce(a.farmer_rate, l.farmer_rate, 0) as farmer_rate,
         coalesce(a.client_rate, l.client_rate, 0) as client_rate,
         l.farmer_bill_to, fc.firm_name as farmer_client_name,
         l.client_bill_to, cc.firm_name as client_client_name,
         cc.client_rate_label,
         a.farmer_doc_id, a.client_doc_id,
         round(a.acres * coalesce(a.farmer_rate, l.farmer_rate, 0), 2) as farmer_amount,
         round(a.acres * coalesce(a.client_rate, l.client_rate, 0), 2) as client_amount
    from public.acre_entries a
    join public.spray_locations l on l.id = a.location_id
    left join public.pilots  p  on p.id  = a.pilot_id
    left join public.clients fc on fc.id = l.farmer_bill_to
    left join public.clients cc on cc.id = l.client_bill_to;
grant select on public.v_acre_billing to authenticated;
