-- ============================================================================
-- 33. Master-data layer: Pilots, Pilot→Location assignments, location locking,
--     client billing label, and acre→billing links.
-- ----------------------------------------------------------------------------
-- Purpose: stop free-text pilot names, tie Client → Location → Pilot together,
-- and prepare acre entries to be invoiced and payment-tracked.
-- Additive only — nothing is dropped and no data is deleted.
-- Run in Supabase → SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------- PILOTS ---
-- A pilot is an individual employed by a VENDOR (the vendor must exist first).
create table if not exists public.pilots (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id),
  name        text not null,
  phone       text,
  rpc_no      text,          -- optional
  drone_uin   text,          -- optional
  pan_no      text,          -- optional
  aadhaar_no  text,          -- optional
  is_active   boolean not null default true,
  notes       text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pilots_vendor_idx on public.pilots(vendor_id);
-- avoid duplicate pilots under the same vendor
create unique index if not exists pilots_vendor_name_uidx
  on public.pilots(vendor_id, lower(btrim(name)));

alter table public.pilots enable row level security;
drop policy if exists pilots_read   on public.pilots;
drop policy if exists pilots_write  on public.pilots;
drop policy if exists pilots_update on public.pilots;
drop policy if exists pilots_delete on public.pilots;
create policy pilots_read   on public.pilots for select to authenticated using (public.is_internal());
create policy pilots_write  on public.pilots for insert to authenticated with check (public.is_internal());
create policy pilots_update on public.pilots for update to authenticated using (public.is_internal());
create policy pilots_delete on public.pilots for delete to authenticated
  using (public.has_role(array['admin']::user_role[]));

-- ------------------------------------------------- PILOT ↔ LOCATION -------
-- A pilot works ONE location at a time. Older assignments can be paused /
-- reactivated so historic data can be corrected, then closed permanently.
create table if not exists public.pilot_assignments (
  id          uuid primary key default gen_random_uuid(),
  pilot_id    uuid not null references public.pilots(id) on delete cascade,
  location_id uuid not null references public.spray_locations(id),
  start_date  date not null default current_date,
  end_date    date,
  status      text not null default 'active',   -- active | paused | closed
  note        text,
  closed_by   uuid references public.profiles(id),
  closed_at   timestamptz,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists pa_pilot_idx on public.pilot_assignments(pilot_id);
create index if not exists pa_loc_idx   on public.pilot_assignments(location_id);
-- hard guarantee: at most ONE active assignment per pilot
create unique index if not exists pa_one_active_per_pilot
  on public.pilot_assignments(pilot_id) where status = 'active';

alter table public.pilot_assignments enable row level security;
drop policy if exists pa_read   on public.pilot_assignments;
drop policy if exists pa_write  on public.pilot_assignments;
drop policy if exists pa_update on public.pilot_assignments;
drop policy if exists pa_delete on public.pilot_assignments;
create policy pa_read   on public.pilot_assignments for select to authenticated using (public.is_internal());
create policy pa_write  on public.pilot_assignments for insert to authenticated with check (public.is_internal());
create policy pa_update on public.pilot_assignments for update to authenticated using (public.is_internal());
create policy pa_delete on public.pilot_assignments for delete to authenticated
  using (public.has_role(array['admin']::user_role[]));

-- Assign a location: closes nothing, but refuses if the pilot already has one
-- active. Use pause_pilot_assignment first to switch.
create or replace function public.assign_pilot_location(p_pilot uuid, p_location uuid, p_start date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_locked boolean;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select is_locked into v_locked from public.spray_locations where id = p_location;
  if coalesce(v_locked,false) then
    raise exception 'That location is locked — unlock it before assigning pilots';
  end if;
  if exists (select 1 from public.pilot_assignments
              where pilot_id = p_pilot and status = 'active') then
    raise exception 'This pilot already has an active location. Pause or close it first.';
  end if;
  insert into public.pilot_assignments(pilot_id, location_id, start_date, status, created_by)
    values (p_pilot, p_location, coalesce(p_start, current_date), 'active', auth.uid())
    returning id into v_id;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'pilot_assigned', 'pilot_assignments', v_id::text, 'location assigned');
  return v_id;
end $$;

-- Pause the pilot's active assignment (frees them to take another location,
-- and lets an older assignment be reactivated for corrections).
create or replace function public.pause_pilot_assignment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  update public.pilot_assignments set status = 'paused' where id = p_id and status = 'active';
  if not found then raise exception 'That assignment is not active'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'pilot_assignment_paused', 'pilot_assignments', p_id::text, null);
end $$;

-- Reactivate an older (paused) assignment so historic data can be edited.
-- Enforces the one-active rule.
create or replace function public.reactivate_pilot_assignment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pilot uuid;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select pilot_id into v_pilot from public.pilot_assignments where id = p_id;
  if v_pilot is null then raise exception 'Assignment not found'; end if;
  if exists (select 1 from public.pilot_assignments
              where pilot_id = v_pilot and status = 'active' and id <> p_id) then
    raise exception 'Pause the pilot''s current active location first';
  end if;
  update public.pilot_assignments set status = 'active', closed_at = null, closed_by = null
   where id = p_id and status <> 'closed';
  if not found then raise exception 'A closed assignment cannot be reactivated'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'pilot_assignment_reactivated', 'pilot_assignments', p_id::text, null);
end $$;

-- Close permanently: no further acre data may be entered for that pilot+location.
create or replace function public.close_pilot_assignment(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  update public.pilot_assignments
     set status='closed', end_date = coalesce(end_date, current_date),
         closed_by = auth.uid(), closed_at = now(), note = coalesce(p_note, note)
   where id = p_id;
  if not found then raise exception 'Assignment not found'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'pilot_assignment_closed', 'pilot_assignments', p_id::text, p_note);
end $$;

grant execute on function public.assign_pilot_location(uuid, uuid, date)  to authenticated;
grant execute on function public.pause_pilot_assignment(uuid)             to authenticated;
grant execute on function public.reactivate_pilot_assignment(uuid)        to authenticated;
grant execute on function public.close_pilot_assignment(uuid, text)       to authenticated;

-- ------------------------------------------------- LOCATION LOCKING -------
alter table public.spray_locations add column if not exists is_locked     boolean not null default false;
alter table public.spray_locations add column if not exists locked_by     uuid references public.profiles(id);
alter table public.spray_locations add column if not exists locked_at     timestamptz;
alter table public.spray_locations add column if not exists lock_note     text;

-- Locking is an approver/admin action (it stops further entry against it).
create or replace function public.set_location_lock(p_id uuid, p_locked boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can lock or unlock a location';
  end if;
  update public.spray_locations
     set is_locked = p_locked,
         locked_by = case when p_locked then auth.uid() else null end,
         locked_at = case when p_locked then now() else null end,
         lock_note = p_note
   where id = p_id;
  if not found then raise exception 'Location not found'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), case when p_locked then 'location_locked' else 'location_unlocked' end,
            'spray_locations', p_id::text, p_note);
end $$;
grant execute on function public.set_location_lock(uuid, boolean, text) to authenticated;

-- ------------------------------------------- CLIENT BILLING LABEL ---------
-- The client-rate component is billed as either Marketing Expense or Subsidy,
-- chosen per client. Same HSN as the service, but 18% GST.
alter table public.clients add column if not exists client_rate_label text
  not null default 'Marketing Expense';
alter table public.clients drop constraint if exists clients_rate_label_chk;
alter table public.clients add constraint clients_rate_label_chk
  check (client_rate_label in ('Marketing Expense','Subsidy'));

-- ------------------------------------------- ACRE → BILLING LINKS ---------
alter table public.acre_entries add column if not exists pilot_id         uuid references public.pilots(id);
alter table public.acre_entries add column if not exists farmer_doc_id    uuid references public.documents(id);
alter table public.acre_entries add column if not exists client_doc_id    uuid references public.documents(id);
alter table public.acre_entries add column if not exists farmer_billed_at timestamptz;
alter table public.acre_entries add column if not exists client_billed_at timestamptz;
create index if not exists acre_farmer_doc_idx on public.acre_entries(farmer_doc_id);
create index if not exists acre_client_doc_idx on public.acre_entries(client_doc_id);
create index if not exists acre_pilot_idx      on public.acre_entries(pilot_id);

-- Unbilled acre work, for the dashboard "missed from billing" signal.
create or replace view public.v_acre_unbilled as
  select a.id, a.entry_date, a.location_id, l.name as location_name, l.client_id,
         a.pilot_id, a.pilot_name, a.acres, a.client_rate, a.farmer_rate, a.amount,
         (a.farmer_doc_id is null) as farmer_unbilled,
         (a.client_doc_id is null) as client_unbilled
    from public.acre_entries a
    left join public.spray_locations l on l.id = a.location_id
   where a.farmer_doc_id is null or a.client_doc_id is null;
grant select on public.v_acre_unbilled to authenticated;
