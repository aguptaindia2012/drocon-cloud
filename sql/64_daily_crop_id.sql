-- ============================================================================
-- 64. Carry crop_id from a daily submission into acre_entries on approval
-- ----------------------------------------------------------------------------
-- Daily Spray Entry now records crop_id (from the Crops register) per row.
-- The approval expansion must store it on acre_entries so crop-wise rates and
-- crop sub-lines on the invoice work. Only the acre_entries insert changes.
-- Additive — replaces one function.
-- ============================================================================

create or replace function public.post_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     public.daily_submissions%rowtype;
  r     jsonb;
  loc   uuid;
  sid   uuid;
  acres numeric; cr numeric; fr numeric; amt numeric; pid uuid; pnm text; cid uuid;
  sids  text[] := array[]::text[];
begin
  select * into s from public.daily_submissions where id = p_id;
  if s.id is null then raise exception 'Submission not found'; end if;
  if s.posted then raise exception 'This submission is already posted'; end if;

  if not (public.has_role(array['admin','approver']::user_role[])
          or s.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to approve this daily submission';
  end if;

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
    pnm   := nullif(btrim(r->>'pilot'),'');
    cid   := nullif(btrim(r->>'crop_id'),'')::uuid;
    if cid is not null and not exists (select 1 from public.crops c where c.id = cid) then cid := null; end if;

    pid := nullif(btrim(r->>'pilot_id'),'')::uuid;
    if pid is not null and not exists (select 1 from public.pilots p where p.id = pid) then
      pid := null;
    end if;
    if pid is null and pnm is not null then
      select p.id into pid from public.pilots p
       where lower(btrim(p.name)) = lower(pnm)
       order by p.created_at limit 1;
    end if;

    if acres = 0 and coalesce(trim(r->>'farmer'),'') = '' then continue; end if;
    amt := acres * (cr + fr);
    sid := gen_random_uuid();
    sids := array_append(sids, sid::text);

    insert into public.acre_entries
      (entry_date, location_id, pilot_id, pilot_name, acres, rate, client_rate, farmer_rate,
       amount, crop, crop_id, chemical, source_id, created_by)
    values
      (s.entry_date, loc, pid, pnm, acres, nullif(cr+fr,0), nullif(cr,0), nullif(fr,0),
       nullif(amt,0), nullif(r->>'crop',''), cid, nullif(r->>'chemical',''), sid, s.submitted_by);

    insert into public.farmer_sprays
      (spray_date, pilot_name, client_name, farmer_name, contact_no, village, state, district,
       chemical_company, crop, acre, rate, amount, gps_image_present, source_id, created_by)
    values
      (s.entry_date, pnm, s.client_name, nullif(r->>'farmer',''), nullif(r->>'phone',''),
       nullif(r->>'village',''), s.state, s.district, nullif(r->>'chemical',''), nullif(r->>'crop',''),
       nullif(acres,0), nullif(cr+fr,0), nullif(amt,0), coalesce((r->>'gps')::boolean,false), sid, s.submitted_by);
  end loop;

  update public.daily_submissions
     set approval_status='approved', approved_by=auth.uid(), approved_at=now(),
         posted=true, posted_source_ids=sids, updated_at=now()
   where id = p_id;
end $$;
