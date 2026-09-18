-- ============================================================================
-- 92. Client Portal — live acre view + entry issue/escalation flow
-- ----------------------------------------------------------------------------
-- Lets a CLIENT log in (external) and see the sprayed-acre data for the
-- locations we assign to them — replacing the periodic Excel sheets with a live
-- view. Read-only over APPROVED data; plus an issue thread so the client can
-- escalate any entry, DroCon resolves after discussion, and either side closes.
--
-- Reuses the external-auth model (profiles.is_external / party_type / party_id)
-- and helpers from sql/65 (my_party_type, is_internal). A client login is:
--   party_type = 'client'   party_id = clients.id
-- created through the same admin/invite provisioning as vendors/pilots.
--
-- Grain note: farmer-level detail (farmer + medicine) lives in farmer_sprays,
-- linked to acre_entries (location + approval_status) via source_id. The client
-- feed is farmer_sprays scoped through that link — matching the farmer-wise
-- Excel already shared. Sensitive farmer phone (contact_no) is never returned.
--
-- Additive / idempotent. Test on a backup first.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Which client does the current login belong to? (null for internal/other)
-- ---------------------------------------------------------------------------
create or replace function public.my_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case when p.party_type = 'client' then p.party_id else null end
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_external,false) = true;
$$;
grant execute on function public.my_client_id() to authenticated;

-- Extend the thread role label (from sql/67) to know 'Client'.
create or replace function public.my_role_label()
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_internal() then 'DroCon'
    when public.my_party_type() = 'client' then 'Client'
    when public.my_party_type() = 'vendor' then 'Vendor'
    when public.my_party_type() = 'pilot'  then 'Pilot'
    else 'User' end;
$$;
grant execute on function public.my_role_label() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Explicit allow-list: which locations each client login may see.
--    (Curated by DroCon — independent of spray_locations.client_id.)
-- ---------------------------------------------------------------------------
create table if not exists public.client_locations (
  client_id   uuid not null references public.clients(id) on delete cascade,
  location_id uuid not null references public.spray_locations(id) on delete cascade,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  primary key (client_id, location_id)
);
alter table public.client_locations enable row level security;

-- Internal staff manage assignments; a client may read its own.
drop policy if exists cl_internal_all on public.client_locations;
create policy cl_internal_all on public.client_locations for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
drop policy if exists cl_client_sel on public.client_locations;
create policy cl_client_sel on public.client_locations for select to authenticated
  using (client_id = public.my_client_id());
grant select, insert, update, delete on public.client_locations to authenticated;

-- Locations assigned to the current client login (names only — no rates).
create or replace function public.my_client_locations()
returns table(id uuid, name text, state text, district text)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.state, l.district
    from public.spray_locations l
   where exists (
     select 1 from public.client_locations cl
      where cl.location_id = l.id and cl.client_id = public.my_client_id())
   order by l.name;
$$;
grant execute on function public.my_client_locations() to authenticated;

-- ---------------------------------------------------------------------------
-- 2b. Client entry issues table (created here so the feed in §3 can reference it;
--     the RPCs that use it are defined later in §4).
--     status: open -> in_review -> resolved -> closed  (any -> closed)
-- ---------------------------------------------------------------------------
create table if not exists public.client_entry_issues (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references public.clients(id) on delete set null,
  location_id    uuid references public.spray_locations(id),
  location_name  text,
  source_id      uuid,                          -- the entry group (farmer_sprays.source_id)
  farmer_spray_id bigint,                        -- the specific farmer row, if any
  occurred_on    date,
  subject        text not null,
  description    text,
  status         text not null default 'open',  -- open | in_review | resolved | closed
  thread         jsonb not null default '[]',   -- [{role,name,at,text}]
  raised_by      uuid references public.profiles(id),
  resolved_by    uuid references public.profiles(id),
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists cei_client_idx on public.client_entry_issues(client_id, status);
create index if not exists cei_spray_idx  on public.client_entry_issues(farmer_spray_id);
alter table public.client_entry_issues enable row level security;

drop policy if exists cei_client_sel on public.client_entry_issues;
create policy cei_client_sel on public.client_entry_issues for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists cei_internal_sel on public.client_entry_issues;
create policy cei_internal_sel on public.client_entry_issues for select to authenticated
  using (public.is_internal());
grant select, insert, update, delete on public.client_entry_issues to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The client's live feed: approved, farmer-wise rows for assigned locations.
--    Works for internal callers too (pass p_client) for preview/QA.
-- ---------------------------------------------------------------------------
create or replace function public.client_spray_rows(
  p_from date default null, p_to date default null, p_client uuid default null)
returns table(
  spray_id     bigint,
  source_id    uuid,
  entry_date   date,
  location_id  uuid,
  location_name text,
  farmer_name  text,
  village      text,
  crop         text,
  medicine     text,
  pilot        text,
  acres        numeric,
  amount       numeric,
  open_issue   boolean)
language sql stable security definer set search_path = public as $$
  with who as (
    select case when public.is_internal() and p_client is not null
                then p_client else public.my_client_id() end as client_id
  ), mine as (
    select cl.location_id from public.client_locations cl, who
     where cl.client_id = who.client_id
  )
  select f.id, f.source_id, f.spray_date,
         a.location_id, l.name,
         f.farmer_name, f.village, f.crop, f.chemical_company,
         coalesce(nullif(btrim(f.pilot_name),''),'') as pilot,
         f.acre, f.amount,
         exists(select 1 from public.client_entry_issues ci
                 where ci.farmer_spray_id = f.id and ci.status <> 'closed') as open_issue
    from public.farmer_sprays f
    join lateral (
      select a.location_id, a.approval_status
        from public.acre_entries a
       where a.source_id = f.source_id
       order by a.id limit 1
    ) a on true
    join public.spray_locations l on l.id = a.location_id
   where (select client_id from who) is not null
     and a.location_id in (select location_id from mine)
     and coalesce(a.approval_status,'approved') = 'approved'
     and (p_from is null or f.spray_date >= p_from)
     and (p_to   is null or f.spray_date <= p_to)
   order by f.spray_date desc, l.name;
$$;
grant execute on function public.client_spray_rows(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Downloadable Excel is RESTRICTED by default. DroCon enables it per client
--     only after an NDA is signed. The live on-screen view is always allowed;
--     the bulk export is gated server-side (not just a hidden button).
-- ---------------------------------------------------------------------------
alter table public.clients add column if not exists portal_export_allowed boolean not null default false;
alter table public.clients add column if not exists portal_export_note     text;   -- e.g. NDA ref / date

-- Does the current client login have export enabled?
create or replace function public.my_client_can_export()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.portal_export_allowed from public.clients c
                    where c.id = public.my_client_id()), false);
$$;
grant execute on function public.my_client_can_export() to authenticated;

-- Gated bulk export: same rows as the live feed, but raises unless enabled.
create or replace function public.client_export_rows(p_from date default null, p_to date default null)
returns table(
  spray_id bigint, source_id uuid, entry_date date, location_id uuid, location_name text,
  farmer_name text, village text, crop text, medicine text, pilot text,
  acres numeric, amount numeric, open_issue boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.my_client_can_export() then
    raise exception 'Downloads are not enabled for your account. Please contact DroCon Bharat.';
  end if;
  return query select * from public.client_spray_rows(p_from, p_to, null);
end $$;
grant execute on function public.client_export_rows(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Client entry issue RPCs (escalations). Table is created in §2b above.
--    status: open -> in_review -> resolved -> closed  (any -> closed)
--    Client raises & may CLOSE; DroCon moves in_review/resolved; both discuss.
-- ---------------------------------------------------------------------------
create or replace function public.cei_can_touch(p public.client_entry_issues)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_internal() or (p.client_id = public.my_client_id());
$$;

-- Client raises an issue on an entry (client set from the caller).
create or replace function public.raise_client_issue(
  p_subject text, p_description text default null,
  p_farmer_spray_id bigint default null, p_source uuid default null,
  p_location uuid default null, p_occurred date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid := public.my_client_id(); rid uuid; locnm text;
begin
  if v_client is null then raise exception 'Only a client login can raise an entry issue'; end if;
  if coalesce(btrim(p_subject),'') = '' then raise exception 'A subject is required'; end if;
  if p_location is not null then select name into locnm from public.spray_locations where id = p_location; end if;
  insert into public.client_entry_issues(client_id, location_id, location_name, source_id,
                                         farmer_spray_id, occurred_on, subject, description, status, raised_by)
    values (v_client, p_location, locnm, p_source, p_farmer_spray_id,
            coalesce(p_occurred, current_date), p_subject, p_description, 'open', auth.uid())
    returning id into rid;
  return rid;
end $$;
grant execute on function public.raise_client_issue(text, text, bigint, uuid, uuid, date) to authenticated;

-- Add a note to the discussion thread (client owner or DroCon).
create or replace function public.add_client_issue_note(p_id uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.client_entry_issues%rowtype; nm text;
begin
  select * into r from public.client_entry_issues where id = p_id;
  if r.id is null then raise exception 'Issue not found'; end if;
  if not public.cei_can_touch(r) then raise exception 'Not permitted'; end if;
  if coalesce(btrim(p_text),'') = '' then return; end if;
  select coalesce(full_name, email) into nm from public.profiles where id = auth.uid();
  update public.client_entry_issues
     set thread = thread || jsonb_build_object('role', public.my_role_label(), 'name', nm,
                                               'at', now(), 'text', p_text),
         updated_at = now()
   where id = p_id;
end $$;
grant execute on function public.add_client_issue_note(uuid, text) to authenticated;

-- Change status. Internal: any status. Client: may only CLOSE.
create or replace function public.set_client_issue_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.client_entry_issues%rowtype; nm text;
begin
  select * into r from public.client_entry_issues where id = p_id;
  if r.id is null then raise exception 'Issue not found'; end if;
  if p_status not in ('open','in_review','resolved','closed') then raise exception 'Bad status'; end if;
  if not (public.is_internal()
          or (r.client_id = public.my_client_id() and p_status = 'closed')) then
    raise exception 'Not permitted';
  end if;
  select coalesce(full_name, email) into nm from public.profiles where id = auth.uid();
  update public.client_entry_issues
     set status = p_status,
         resolved_by = case when p_status in ('resolved','closed') then auth.uid() else resolved_by end,
         resolved_at = case when p_status in ('resolved','closed') then now() else resolved_at end,
         thread = case when coalesce(btrim(p_note),'')='' then thread
                       else thread || jsonb_build_object('role', public.my_role_label(), 'name', nm,
                                                          'at', now(), 'text', '['||p_status||'] '||p_note) end,
         updated_at = now()
   where id = p_id;
end $$;
grant execute on function public.set_client_issue_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Internal view of all client issues (for the DroCon-side resolution queue).
-- ---------------------------------------------------------------------------
create or replace view public.v_client_issues as
  select ci.*, c.name as client_name
    from public.client_entry_issues ci
    left join public.clients c on c.id = ci.client_id;
grant select on public.v_client_issues to authenticated;
