-- ============================================================================
-- DroCon Cloud — carry Medicine/Chemical into Acre entries as well (bug fix)
-- The Daily Spray Entry captures a per-row Medicine/Chemical. It was already
-- posted into farmer_sprays.chemical_company, but NOT into acre_entries. This
-- adds the column and re-posts it, so Medicine shows on the Acre side too.
-- Safe to re-run.
-- ============================================================================

alter table public.acre_entries add column if not exists chemical text;

-- Re-create the approve+post function so it also writes chemical into acre_entries.
create or replace function public.post_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     public.daily_submissions%rowtype;
  r     jsonb;
  loc   uuid;
  sid   uuid;
  acres numeric; cr numeric; fr numeric; amt numeric;
  sids  text[] := array[]::text[];
begin
  select * into s from public.daily_submissions where id = p_id;
  if s.id is null then raise exception 'Submission not found'; end if;
  if s.posted then raise exception 'This submission is already posted'; end if;

  -- authorisation: admin/approver, or the assigned reviewer
  if not (public.has_role(array['admin','approver']::user_role[])
          or s.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to approve this daily submission';
  end if;

  -- resolve (or create) the spray location by name
  select id into loc from public.spray_locations where lower(name) = lower(s.location_name) limit 1;
  if loc is null then
    insert into public.spray_locations(name, state, district, rates)
      values (s.location_name, s.state, s.district, '{}'::jsonb) returning id into loc;
  end if;

  for r in select * from jsonb_array_elements(s.rows) loop
    acres := coalesce(nullif(r->>'acres','')::numeric, 0);
    cr    := coalesce(nullif(r->>'crate','')::numeric, 0);
    fr    := coalesce(nullif(r->>'frate','')::numeric, 0);
    -- skip empty rows (no acres and no farmer)
    if acres = 0 and coalesce(trim(r->>'farmer'),'') = '' then continue; end if;
    amt := acres * (cr + fr);
    sid := gen_random_uuid();
    sids := array_append(sids, sid::text);

    insert into public.acre_entries
      (entry_date, location_id, pilot_name, acres, rate, client_rate, farmer_rate, amount, crop, chemical, source_id, created_by)
    values
      (s.entry_date, loc, nullif(r->>'pilot',''), acres, nullif(cr+fr,0), nullif(cr,0), nullif(fr,0),
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
grant execute on function public.post_daily_submission(uuid) to authenticated;

-- ============================================================================
-- Done. Medicine/Chemical now posts into acre_entries too (column: chemical).
-- ============================================================================
