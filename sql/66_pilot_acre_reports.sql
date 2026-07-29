-- ============================================================================
-- 66. Vendor & Pilot Portal — Phase 2: pilot acre reporting + review chain
-- ----------------------------------------------------------------------------
-- Flow:  pilot submits acres  →  vendor reviews/corrects  →  DroCon approves.
-- On DroCon approval the report POSTS into the same acre_entries / farmer_sprays
-- pipeline as internal daily submissions, so it flows to Acre Invoicing,
-- Receivables and the Vendor report. Rates are NOT taken from the pilot — they
-- are resolved server-side from location_crop_rates (DroCon-controlled).
--
-- Status: submitted → vendor_ok → approved   (or → rejected at either stage)
-- Additive / idempotent.
-- ============================================================================

create table if not exists public.pilot_acre_reports (
  id            uuid primary key default gen_random_uuid(),
  pilot_id      uuid not null references public.pilots(id) on delete cascade,
  vendor_id     uuid not null references public.vendors(id),
  entry_date    date not null,
  location_id   uuid not null references public.spray_locations(id),
  location_name text,                          -- denormalised (external users can't read spray_locations)
  rows          jsonb not null default '[]',   -- [{farmer,phone,village,crop,crop_id,chemical,acres,gps}]
  status        text not null default 'submitted',  -- submitted | vendor_ok | approved | rejected
  note          text,                          -- pilot note
  reject_reason text,
  submitted_by  uuid references public.profiles(id),
  reviewed_by   uuid references public.profiles(id),   -- vendor
  approved_by   uuid references public.profiles(id),   -- DroCon
  posted        boolean not null default false,
  posted_source_ids text[],
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  approved_at   timestamptz
);
create index if not exists par_pilot_idx  on public.pilot_acre_reports(pilot_id, entry_date);
create index if not exists par_vendor_idx on public.pilot_acre_reports(vendor_id, status);
create index if not exists par_loc_idx    on public.pilot_acre_reports(location_id, entry_date);

alter table public.pilot_acre_reports enable row level security;

-- Pilot: manage own reports; may edit/withdraw only while still 'submitted'.
drop policy if exists par_pilot_sel on public.pilot_acre_reports;
create policy par_pilot_sel on public.pilot_acre_reports for select to authenticated
  using (pilot_id = public.my_pilot_id());
drop policy if exists par_pilot_ins on public.pilot_acre_reports;
create policy par_pilot_ins on public.pilot_acre_reports for insert to authenticated
  with check (pilot_id = public.my_pilot_id() and vendor_id = public.my_vendor_id() and status = 'submitted');
drop policy if exists par_pilot_upd on public.pilot_acre_reports;
create policy par_pilot_upd on public.pilot_acre_reports for update to authenticated
  using (pilot_id = public.my_pilot_id() and status = 'submitted')
  with check (pilot_id = public.my_pilot_id() and status = 'submitted');
drop policy if exists par_pilot_del on public.pilot_acre_reports;
create policy par_pilot_del on public.pilot_acre_reports for delete to authenticated
  using (pilot_id = public.my_pilot_id() and status = 'submitted');

-- Vendor: read its pilots' reports (edits go through the RPC below).
drop policy if exists par_vendor_sel on public.pilot_acre_reports;
create policy par_vendor_sel on public.pilot_acre_reports for select to authenticated
  using (vendor_id = public.my_vendor_id());

-- Internal: read all (approve/reject via the RPCs below).
drop policy if exists par_internal_sel on public.pilot_acre_reports;
create policy par_internal_sel on public.pilot_acre_reports for select to authenticated
  using (public.is_internal());

grant select, insert, update, delete on public.pilot_acre_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Locations a pilot may report against = its active assignments. (Pilots are
-- external and cannot read spray_locations directly.) Names only — no rates.
-- ---------------------------------------------------------------------------
create or replace function public.my_pilot_locations()
returns table(id uuid, name text, state text, district text)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.state, l.district
    from public.spray_locations l
   where exists (
     select 1 from public.pilot_assignments pa
      where pa.location_id = l.id and pa.pilot_id = public.my_pilot_id()
        and coalesce(pa.status,'active') <> 'closed')
   order by l.name;
$$;
grant execute on function public.my_pilot_locations() to authenticated;

-- ---------------------------------------------------------------------------
-- Pilot submit / resubmit. Sets pilot & vendor from the caller and enforces
-- that the location is one the pilot is assigned to. Returns the report id.
-- ---------------------------------------------------------------------------
create or replace function public.submit_pilot_report(p_location uuid, p_date date, p_rows jsonb, p_note text default null, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pilot uuid := public.my_pilot_id(); v_vendor uuid := public.my_vendor_id(); rid uuid; locnm text;
begin
  if v_pilot is null then raise exception 'Not a pilot login'; end if;
  if not exists (select 1 from public.pilot_assignments pa
                  where pa.pilot_id = v_pilot and pa.location_id = p_location
                    and coalesce(pa.status,'active') <> 'closed') then
    raise exception 'You are not assigned to this location — ask DroCon to assign you'; end if;
  select name into locnm from public.spray_locations where id = p_location;
  if p_id is not null then
    update public.pilot_acre_reports
       set location_id=p_location, location_name=locnm, entry_date=p_date, rows=coalesce(p_rows,'[]'::jsonb),
           note=p_note, status='submitted', reject_reason=null, updated_at=now()
     where id=p_id and pilot_id=v_pilot and status in ('submitted','rejected')
     returning id into rid;
    if rid is null then raise exception 'This report can no longer be edited'; end if;
    return rid;
  end if;
  insert into public.pilot_acre_reports(pilot_id, vendor_id, entry_date, location_id, location_name, rows, note, status, submitted_by)
    values (v_pilot, v_vendor, p_date, p_location, locnm, coalesce(p_rows,'[]'::jsonb), p_note, 'submitted', auth.uid())
    returning id into rid;
  return rid;
end $$;
grant execute on function public.submit_pilot_report(uuid, date, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Vendor review: correct rows and pass on (vendor_ok) or send back (rejected).
-- ---------------------------------------------------------------------------
create or replace function public.vendor_review_report(p_id uuid, p_status text, p_rows jsonb default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.pilot_acre_reports%rowtype;
begin
  select * into r from public.pilot_acre_reports where id = p_id;
  if r.id is null then raise exception 'Report not found'; end if;
  if not (public.my_party_type() = 'vendor' and r.vendor_id = public.my_vendor_id()) then
    raise exception 'Not permitted'; end if;
  if r.status not in ('submitted','vendor_ok','rejected') then
    raise exception 'This report is already with DroCon / posted'; end if;
  if p_status not in ('vendor_ok','rejected','submitted') then raise exception 'Bad status'; end if;
  update public.pilot_acre_reports
     set rows = coalesce(p_rows, rows), status = p_status,
         reject_reason = case when p_status='rejected' then p_reason else reject_reason end,
         reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_id;
end $$;
grant execute on function public.vendor_review_report(uuid, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- DroCon reject (internal).
-- ---------------------------------------------------------------------------
create or replace function public.reject_pilot_report(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  update public.pilot_acre_reports
     set status='rejected', reject_reason=p_reason, approved_by=auth.uid(), approved_at=now(), updated_at=now()
   where id = p_id and posted = false;
  if not found then raise exception 'Report not found or already posted'; end if;
end $$;
grant execute on function public.reject_pilot_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- DroCon approve + POST (internal). Resolves DroCon-controlled rates per row
-- from location_crop_rates and expands into acre_entries + farmer_sprays,
-- exactly like post_daily_submission so downstream billing is identical.
-- ---------------------------------------------------------------------------
create or replace function public.post_pilot_report(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s      public.pilot_acre_reports%rowtype;
  r      jsonb;
  loc    public.spray_locations%rowtype;
  clientnm text;
  cid    uuid; acres numeric; cr numeric; fr numeric; amt numeric;
  sid    uuid; sids text[] := array[]::text[];
  pnm    text;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select * into s from public.pilot_acre_reports where id = p_id;
  if s.id is null then raise exception 'Report not found'; end if;
  if s.posted then raise exception 'This report is already posted'; end if;

  select * into loc from public.spray_locations where id = s.location_id;
  select coalesce(c.firm_name, c.name) into clientnm from public.clients c where c.id = loc.client_id;
  select coalesce(p.name, '') into pnm from public.pilots p where p.id = s.pilot_id;

  for r in select * from jsonb_array_elements(s.rows) loop
    acres := coalesce(nullif(r->>'acres','')::numeric, 0);
    cid   := nullif(btrim(r->>'crop_id'),'')::uuid;
    if cid is not null and not exists (select 1 from public.crops c where c.id = cid) then cid := null; end if;
    if acres = 0 and coalesce(trim(r->>'farmer'),'') = '' then continue; end if;

    -- DroCon-controlled rate in force for this location/crop on the entry date
    select lr.farmer_rate, lr.client_rate into fr, cr
      from public.location_rate_on(s.location_id, cid, s.entry_date) lr;
    fr := coalesce(fr,0); cr := coalesce(cr,0);
    amt := acres * (cr + fr);
    sid := gen_random_uuid(); sids := array_append(sids, sid::text);

    insert into public.acre_entries
      (entry_date, location_id, pilot_id, pilot_name, acres, rate, client_rate, farmer_rate,
       amount, crop, crop_id, chemical, source_id, created_by)
    values
      (s.entry_date, s.location_id, s.pilot_id, pnm, acres, nullif(cr+fr,0), nullif(cr,0), nullif(fr,0),
       nullif(amt,0), nullif(r->>'crop',''), cid, nullif(r->>'chemical',''), sid, s.submitted_by);

    insert into public.farmer_sprays
      (spray_date, pilot_name, client_name, farmer_name, contact_no, village, state, district,
       chemical_company, crop, acre, rate, amount, gps_image_present, source_id, created_by)
    values
      (s.entry_date, pnm, clientnm, nullif(r->>'farmer',''), nullif(r->>'phone',''),
       nullif(r->>'village',''), loc.state, loc.district, nullif(r->>'chemical',''), nullif(r->>'crop',''),
       nullif(acres,0), nullif(cr+fr,0), nullif(amt,0), coalesce((r->>'gps')::boolean,false), sid, s.submitted_by);
  end loop;

  update public.pilot_acre_reports
     set status='approved', posted=true, posted_source_ids=sids,
         approved_by=auth.uid(), approved_at=now(), updated_at=now()
   where id = p_id;
end $$;
grant execute on function public.post_pilot_report(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Previous-day view for the INTERNAL daily form: what pilots already reported
-- (posted acre_entries + still-pending pilot reports) so the team never
-- double-enters. Read by internal staff.
-- ---------------------------------------------------------------------------
create or replace view public.v_recent_pilot_acres as
  select a.entry_date, a.location_id, l.name as location_name,
         coalesce(pp.name, a.pilot_name) as pilot_name,
         a.acres, a.crop, 'posted'::text as state
    from public.acre_entries a
    join public.spray_locations l on l.id = a.location_id
    left join public.pilots pp on pp.id = a.pilot_id
   where a.entry_date >= current_date - 3
  union all
  select r.entry_date, r.location_id, l.name as location_name,
         pp.name as pilot_name,
         coalesce((x->>'acres')::numeric,0) as acres, x->>'crop' as crop,
         r.status as state
    from public.pilot_acre_reports r
    join public.spray_locations l on l.id = r.location_id
    left join public.pilots pp on pp.id = r.pilot_id
    left join lateral jsonb_array_elements(r.rows) x on true
   where r.entry_date >= current_date - 3 and r.posted = false and r.status <> 'rejected';
grant select on public.v_recent_pilot_acres to authenticated;
