-- ============================================================================
-- 123. Location change requests — maker-checker approval for Location setup
-- ----------------------------------------------------------------------------
-- Every create / edit / rate change / crop-rate / pilot change to a Location is
-- HELD as a change request and does NOT take effect until a DIFFERENT team member
-- approves it (true maker-checker — no one can approve their own change, admins
-- included). On approval a SECURITY DEFINER RPC applies the parked payload to the
-- real tables; on rejection nothing was ever touched.
--
-- Phase 1 handles kinds: create, edit, crop_rate_add, crop_rate_delete, delete.
-- (pilot_assign / pilot_end are reserved for Phase 2.)
-- Additive / idempotent.
-- ============================================================================
create table if not exists public.location_change_requests (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid references public.spray_locations(id) on delete cascade,  -- null for 'create'
  kind          text not null check (kind in ('create','edit','crop_rate_add','crop_rate_delete','pilot_assign','pilot_end','delete')),
  payload       jsonb not null default '{}'::jsonb,
  summary       text,
  status        text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  submitted_by  uuid references public.profiles(id),
  assigned_approver uuid references public.profiles(id),
  submitted_at  timestamptz not null default now(),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  reject_note   text,
  applied_id    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists lcr_status_idx   on public.location_change_requests(status);
create index if not exists lcr_location_idx on public.location_change_requests(location_id);

alter table public.location_change_requests enable row level security;
drop policy if exists lcr_select on public.location_change_requests;
create policy lcr_select on public.location_change_requests for select to authenticated
  using (public.is_internal());
-- writes go through the RPCs below (security definer); no direct insert/update.

-- ---------------------------------------------------------------------------
-- submit_location_change — park a proposed change for review. submitted_by is
-- stamped from auth.uid() so it cannot be spoofed.
-- ---------------------------------------------------------------------------
create or replace function public.submit_location_change(
  p_location_id uuid, p_kind text, p_payload jsonb, p_summary text, p_approver uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  insert into public.location_change_requests(location_id, kind, payload, summary, submitted_by, assigned_approver)
    values (p_location_id, p_kind, coalesce(p_payload,'{}'::jsonb), p_summary, auth.uid(), p_approver)
    returning id into rid;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'submitted', 'location_change_requests', rid::text, coalesce(p_summary,p_kind));
  return rid;
end $$;
grant execute on function public.submit_location_change(uuid, text, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_location_change — apply the parked payload to the live tables, then
-- mark approved. Maker-checker: approver must be admin/approver (or the assigned
-- reviewer) AND must NOT be the submitter.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- reject_location_change — discard the parked change (nothing was applied).
-- ---------------------------------------------------------------------------
create or replace function public.reject_location_change(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.location_change_requests%rowtype;
begin
  select * into r from public.location_change_requests where id = p_id;
  if r.id is null then raise exception 'Change request not found'; end if;
  if r.status <> 'submitted' then raise exception 'This request is already %', r.status; end if;
  if not (public.has_role(array['admin','approver']::user_role[]) or r.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to reject this change'; end if;
  update public.location_change_requests
     set status='rejected', approved_by=auth.uid(), approved_at=now(), reject_note=p_note
   where id = p_id;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'rejected', 'location_change_requests', p_id::text, coalesce(p_note,''));
end $$;
grant execute on function public.reject_location_change(uuid, text) to authenticated;
