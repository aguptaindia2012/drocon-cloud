-- ============================================================================
-- 124. Location change requests — pilot assignment / close (Phase 2)
-- ----------------------------------------------------------------------------
-- Extends approve_location_change to apply the two pilot kinds on approval:
--   pilot_assign : add a pilot to the location (replicates assign_pilot_location
--                  guards: location not locked, pilot has no active assignment)
--   pilot_end    : close an assignment (replicates close_pilot_assignment)
-- (pause / reactivate stay immediate — reversible operational toggles.)
-- Idempotent: create or replace of the one function.
-- ============================================================================
create or replace function public.approve_location_change(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.location_change_requests%rowtype; c jsonb; new_id uuid;
begin
  select * into r from public.location_change_requests where id = p_id;
  if r.id is null then raise exception 'Change request not found'; end if;
  if r.status <> 'submitted' then raise exception 'This request is already %', r.status; end if;
  if not (public.has_role(array['admin','approver']::user_role[]) or r.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to approve this change'; end if;
  if r.submitted_by = auth.uid() then
    raise exception 'A change must be approved by a different team member (no self-approval).'; end if;
  c := coalesce(r.payload, '{}'::jsonb);

  if r.kind = 'create' then
    insert into public.spray_locations(name, client_id, district, state,
        farmer_rate, client_rate, farmer_bill_to, client_bill_to, rates, created_by)
      values (c->>'name', nullif(c->>'client_id','')::uuid, nullif(c->>'district',''), nullif(c->>'state',''),
        nullif(c->>'farmer_rate','')::numeric, coalesce(nullif(c->>'client_rate','')::numeric,0),
        nullif(c->>'farmer_bill_to','')::uuid, nullif(c->>'client_bill_to','')::uuid,
        coalesce(c->'rates','{}'::jsonb), r.submitted_by)
      returning id into new_id;

  elsif r.kind = 'edit' then
    update public.spray_locations set
      name           = coalesce(nullif(c->>'name',''), name),
      client_id      = coalesce(nullif(c->>'client_id','')::uuid, client_id),
      district       = case when c ? 'district' then nullif(c->>'district','') else district end,
      state          = case when c ? 'state'    then nullif(c->>'state','')    else state end,
      farmer_rate    = case when c ? 'farmer_rate' then nullif(c->>'farmer_rate','')::numeric else farmer_rate end,
      client_rate    = case when c ? 'client_rate' then coalesce(nullif(c->>'client_rate','')::numeric,0) else client_rate end,
      farmer_bill_to = case when c ? 'farmer_bill_to' then nullif(c->>'farmer_bill_to','')::uuid else farmer_bill_to end,
      client_bill_to = case when c ? 'client_bill_to' then nullif(c->>'client_bill_to','')::uuid else client_bill_to end,
      rates          = case when c ? 'rates' then coalesce(c->'rates', rates) else rates end
     where id = r.location_id;
    new_id := r.location_id;

  elsif r.kind = 'crop_rate_add' then
    insert into public.location_crop_rates(location_id, crop_id, farmer_rate, client_rate, effective_from, created_by)
      values (r.location_id, nullif(c->>'crop_id','')::uuid,
        nullif(c->>'farmer_rate','')::numeric, nullif(c->>'client_rate','')::numeric,
        coalesce(nullif(c->>'effective_from','')::date, current_date), r.submitted_by)
      returning id into new_id;

  elsif r.kind = 'crop_rate_delete' then
    delete from public.location_crop_rates where id = nullif(c->>'rate_id','')::uuid and location_id = r.location_id;
    new_id := nullif(c->>'rate_id','')::uuid;

  elsif r.kind = 'pilot_assign' then
    if coalesce((select is_locked from public.spray_locations where id = r.location_id), false) then
      raise exception 'That location is locked — unlock it before assigning pilots'; end if;
    if exists (select 1 from public.pilot_assignments
                where pilot_id = nullif(c->>'pilot_id','')::uuid and status = 'active') then
      raise exception 'This pilot already has an active location. Pause or close it first.'; end if;
    insert into public.pilot_assignments(pilot_id, location_id, start_date, status, created_by)
      values (nullif(c->>'pilot_id','')::uuid, r.location_id,
        coalesce(nullif(c->>'start_date','')::date, current_date), 'active', r.submitted_by)
      returning id into new_id;

  elsif r.kind = 'pilot_end' then
    update public.pilot_assignments
       set status='closed', end_date = coalesce(nullif(c->>'end_date','')::date, end_date, current_date),
           closed_by = auth.uid(), closed_at = now(), note = coalesce(nullif(c->>'note',''), note)
     where id = nullif(c->>'assignment_id','')::uuid;
    new_id := nullif(c->>'assignment_id','')::uuid;

  elsif r.kind = 'delete' then
    delete from public.spray_locations where id = r.location_id;
    new_id := r.location_id;

  else
    raise exception 'Unsupported change kind: %', r.kind;
  end if;

  update public.location_change_requests
     set status='approved', approved_by=auth.uid(), approved_at=now(), applied_id=new_id
   where id = p_id;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'approved', 'location_change_requests', p_id::text, coalesce(r.summary,r.kind));
  return new_id;
end $$;
grant execute on function public.approve_location_change(uuid) to authenticated;
