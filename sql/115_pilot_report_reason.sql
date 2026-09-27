-- ============================================================================
-- 115. Store the pilot's short-day reason ON the report (reliable)
-- ----------------------------------------------------------------------------
-- Previously the pilot's reason went to short_day_logs via a separate,
-- assignment-gated RPC whose error was swallowed — so it could silently fail
-- and never reach the DroCon approval screen. Now:
--   • pilot_acre_reports.short_reason stores it at submit time (always shown),
--   • post_pilot_report writes it into short_day_logs on approval, so it also
--     flows to the internal Entries and the vendor/client portals.
-- ============================================================================
alter table public.pilot_acre_reports add column if not exists short_reason text;

-- submit / resubmit now also records the short-day reason on the report.
drop function if exists public.submit_pilot_report(uuid, date, jsonb, text, uuid);
create or replace function public.submit_pilot_report(
  p_location uuid, p_date date, p_rows jsonb, p_note text default null, p_id uuid default null, p_reason text default null)
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
           note=p_note, short_reason=p_reason, status='submitted', reject_reason=null, updated_at=now()
     where id=p_id and pilot_id=v_pilot and status in ('submitted','rejected')
     returning id into rid;
    if rid is null then raise exception 'This report can no longer be edited'; end if;
    return rid;
  end if;
  insert into public.pilot_acre_reports(pilot_id, vendor_id, entry_date, location_id, location_name, rows, note, short_reason, status, submitted_by)
    values (v_pilot, v_vendor, p_date, p_location, locnm, coalesce(p_rows,'[]'::jsonb), p_note, p_reason, 'submitted', auth.uid())
    returning id into rid;
  return rid;
end $$;
grant execute on function public.submit_pilot_report(uuid, date, jsonb, text, uuid, text) to authenticated;

-- Approve + POST: unchanged, plus write the short-day reason into short_day_logs
-- so it appears on the internal Entries and the vendor/client portals.
create or replace function public.post_pilot_report(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s      public.pilot_acre_reports%rowtype;
  r      jsonb;
  loc    public.spray_locations%rowtype;
  clientnm text;
  cid    uuid; acres numeric; cr numeric; fr numeric; amt numeric;
  sid    uuid; sids text[] := array[]::text[];
  pnm    text; tot numeric := 0;
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
    tot := tot + acres;

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

  -- flow the short-day reason downstream (entries + vendor/client portals)
  if coalesce(nullif(btrim(s.short_reason),''),'') <> '' then
    insert into public.short_day_logs(entry_date, location_id, location_name, pilot_name, acres, reason, recorded_by)
    values (s.entry_date, s.location_id, loc.name, coalesce(nullif(btrim(pnm),''),'(unassigned)'), tot, s.short_reason, auth.uid())
    on conflict (entry_date, location_id, pilot_name) do update
       set reason = excluded.reason,
           acres = coalesce(excluded.acres, public.short_day_logs.acres),
           recorded_by = auth.uid(), updated_at = now();
  end if;

  update public.pilot_acre_reports
     set status='approved', posted=true, posted_source_ids=sids,
         approved_by=auth.uid(), approved_at=now(), updated_at=now()
   where id = p_id;
end $$;
grant execute on function public.post_pilot_report(uuid) to authenticated;
