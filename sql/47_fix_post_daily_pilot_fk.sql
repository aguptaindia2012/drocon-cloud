-- ============================================================================
-- 47. Fix: approving a day failed with
--     'insert or update on table "acre_entries" violates foreign key
--      constraint "acre_entries_pilot_id_fkey"'
-- ----------------------------------------------------------------------------
-- A daily submission stores its rows as JSON, including the pilot_id chosen at
-- entry time. If that pilot record is later removed or replaced (e.g. during the
-- duplicate-pilot clean-up), the saved id no longer exists and the approval
-- insert fails — blocking the whole day.
--
-- Approval must never be blocked by a master-data change. Now, per row:
--   1. use the stored pilot_id if it still exists;
--   2. otherwise recover it by matching the pilot NAME on the row;
--   3. otherwise fall back to null, keeping the typed name so nothing is lost.
-- Additive — replaces one function; nothing dropped, no data deleted.
-- ============================================================================

create or replace function public.post_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     public.daily_submissions%rowtype;
  r     jsonb;
  loc   uuid;
  sid   uuid;
  acres numeric; cr numeric; fr numeric; amt numeric; pid uuid; pnm text;
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
    pnm   := nullif(btrim(r->>'pilot'),'');

    -- resolve the pilot defensively so a changed master record cannot block approval
    pid := nullif(btrim(r->>'pilot_id'),'')::uuid;
    if pid is not null and not exists (select 1 from public.pilots p where p.id = pid) then
      pid := null;                                   -- stored id no longer exists
    end if;
    if pid is null and pnm is not null then          -- recover by name if we can
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
       amount, crop, chemical, source_id, created_by)
    values
      (s.entry_date, loc, pid, pnm, acres, nullif(cr+fr,0), nullif(cr,0), nullif(fr,0),
       nullif(amt,0), nullif(r->>'crop',''), nullif(r->>'chemical',''), sid, s.submitted_by);

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

-- ---------------------------------------------------------------------------
-- Root cause: delete_pilot() only checked assignments and acre_entries, so a
-- pilot referenced by a PENDING submission could still be deleted. Close that.
-- ---------------------------------------------------------------------------
create or replace function public.delete_pilot(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_assign int; v_acres int; v_pending int;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select count(*) into v_assign from public.pilot_assignments where pilot_id = p_id;
  select count(*) into v_acres  from public.acre_entries      where pilot_id = p_id;
  select count(*) into v_pending
    from public.daily_submissions s, lateral jsonb_array_elements(s.rows) x
   where s.posted = false
     and nullif(btrim(x->>'pilot_id'),'') = p_id::text;

  if v_assign > 0 then
    raise exception 'Cannot delete: this pilot has % location assignment(s). Close and remove them first.', v_assign;
  end if;
  if v_acres > 0 then
    raise exception 'Cannot delete: % acre entr(ies) are linked to this pilot.', v_acres;
  end if;
  if v_pending > 0 then
    raise exception 'Cannot delete: this pilot is used on % daily submission(s) still awaiting approval. Approve or edit them first.', v_pending;
  end if;

  delete from public.pilots where id = p_id;
  if not found then raise exception 'Pilot not found'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'deleted', 'pilots', p_id::text, 'duplicate cleanup');
end $$;
grant execute on function public.delete_pilot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Optional check: which pending submissions still carry a pilot_id that no
-- longer exists? After the fix these approve fine (recovered by name, or the
-- name is kept with no link) — this just shows where it happened.
-- ---------------------------------------------------------------------------
-- select s.id, s.entry_date, s.location_name,
--        x->>'pilot' as pilot_name, x->>'pilot_id' as stale_pilot_id
--   from public.daily_submissions s,
--        lateral jsonb_array_elements(s.rows) x
--  where s.posted = false
--    and nullif(btrim(x->>'pilot_id'),'') is not null
--    and not exists (select 1 from public.pilots p
--                     where p.id = nullif(btrim(x->>'pilot_id'),'')::uuid);
