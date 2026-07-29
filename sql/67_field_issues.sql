-- ============================================================================
-- 67. Vendor & Pilot Portal — Phase 3: field-issue reporting
-- ----------------------------------------------------------------------------
-- A pilot raises a field issue (drone/chemical/access/farmer/etc.). Their
-- vendor and the DroCon team can see it, discuss it on a thread, and set its
-- status. Reuses the external-auth helpers from sql/65.
--   status: open → in_review → resolved → closed  (any → closed)
-- Additive / idempotent.
-- ============================================================================

create table if not exists public.field_issues (
  id            uuid primary key default gen_random_uuid(),
  pilot_id      uuid references public.pilots(id) on delete set null,
  vendor_id     uuid references public.vendors(id),
  location_id   uuid references public.spray_locations(id),
  location_name text,
  occurred_on   date,
  category      text,                          -- drone | chemical | access | farmer | weather | payment | other
  severity      text not null default 'medium',-- low | medium | high
  subject       text not null,
  description   text,
  status        text not null default 'open',  -- open | in_review | resolved | closed
  thread        jsonb not null default '[]',   -- [{role,name,at,text}]
  raised_by     uuid references public.profiles(id),
  resolved_by   uuid references public.profiles(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists fi_pilot_idx  on public.field_issues(pilot_id, created_at desc);
create index if not exists fi_vendor_idx on public.field_issues(vendor_id, status);

alter table public.field_issues enable row level security;

-- Read: pilot own, vendor its pilots', internal all.
drop policy if exists fi_pilot_sel on public.field_issues;
create policy fi_pilot_sel on public.field_issues for select to authenticated
  using (pilot_id = public.my_pilot_id());
drop policy if exists fi_vendor_sel on public.field_issues;
create policy fi_vendor_sel on public.field_issues for select to authenticated
  using (vendor_id = public.my_vendor_id());
drop policy if exists fi_internal_sel on public.field_issues;
create policy fi_internal_sel on public.field_issues for select to authenticated
  using (public.is_internal());
grant select, insert, update, delete on public.field_issues to authenticated;

-- ---------------------------------------------------------------------------
-- Who is acting, for thread labels.
-- ---------------------------------------------------------------------------
create or replace function public.my_role_label()
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_internal() then 'DroCon'
    when public.my_party_type() = 'vendor' then 'Vendor'
    when public.my_party_type() = 'pilot'  then 'Pilot'
    else 'User' end;
$$;
grant execute on function public.my_role_label() to authenticated;

create or replace function public.fi_can_touch(p public.field_issues)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_internal()
      or (p.pilot_id  = public.my_pilot_id())
      or (public.my_party_type() = 'vendor' and p.vendor_id = public.my_vendor_id());
$$;

-- ---------------------------------------------------------------------------
-- Pilot raises an issue (pilot/vendor set from the caller; location optional).
-- ---------------------------------------------------------------------------
create or replace function public.raise_field_issue(
  p_subject text, p_description text default null, p_category text default null,
  p_severity text default 'medium', p_location uuid default null, p_occurred date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pilot uuid := public.my_pilot_id(); v_vendor uuid := public.my_vendor_id(); rid uuid; locnm text;
begin
  if v_pilot is null then raise exception 'Only a pilot login can raise a field issue here'; end if;
  if coalesce(btrim(p_subject),'') = '' then raise exception 'A subject is required'; end if;
  if p_location is not null then select name into locnm from public.spray_locations where id = p_location; end if;
  insert into public.field_issues(pilot_id, vendor_id, location_id, location_name, occurred_on,
                                   category, severity, subject, description, status, raised_by)
    values (v_pilot, v_vendor, p_location, locnm, coalesce(p_occurred, current_date),
            p_category, coalesce(p_severity,'medium'), p_subject, p_description, 'open', auth.uid())
    returning id into rid;
  return rid;
end $$;
grant execute on function public.raise_field_issue(text, text, text, text, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Add a note to the thread (pilot owner, its vendor, or DroCon).
-- ---------------------------------------------------------------------------
create or replace function public.add_issue_note(p_id uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.field_issues%rowtype; nm text;
begin
  select * into r from public.field_issues where id = p_id;
  if r.id is null then raise exception 'Issue not found'; end if;
  if not public.fi_can_touch(r) then raise exception 'Not permitted'; end if;
  if coalesce(btrim(p_text),'') = '' then return; end if;
  select coalesce(full_name, email) into nm from public.profiles where id = auth.uid();
  update public.field_issues
     set thread = thread || jsonb_build_object('role', public.my_role_label(), 'name', nm,
                                               'at', now(), 'text', p_text),
         updated_at = now()
   where id = p_id;
end $$;
grant execute on function public.add_issue_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Change status (vendor or DroCon only). Optional note is added to the thread.
-- ---------------------------------------------------------------------------
create or replace function public.set_issue_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.field_issues%rowtype; nm text;
begin
  select * into r from public.field_issues where id = p_id;
  if r.id is null then raise exception 'Issue not found'; end if;
  if not (public.is_internal() or (public.my_party_type()='vendor' and r.vendor_id = public.my_vendor_id())) then
    raise exception 'Not permitted'; end if;
  if p_status not in ('open','in_review','resolved','closed') then raise exception 'Bad status'; end if;
  select coalesce(full_name, email) into nm from public.profiles where id = auth.uid();
  update public.field_issues
     set status = p_status,
         resolved_by = case when p_status in ('resolved','closed') then auth.uid() else resolved_by end,
         resolved_at = case when p_status in ('resolved','closed') then now() else resolved_at end,
         thread = case when coalesce(btrim(p_note),'')='' then thread
                       else thread || jsonb_build_object('role', public.my_role_label(), 'name', nm,
                                                          'at', now(), 'text', '['||p_status||'] '||p_note) end,
         updated_at = now()
   where id = p_id;
end $$;
grant execute on function public.set_issue_status(uuid, text, text) to authenticated;
