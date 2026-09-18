-- ============================================================================
-- 95. Short-day reasons (<12 acres) + multiple client POC logins
-- ----------------------------------------------------------------------------
-- (A) SHORT-DAY REASONS: for any pilot-day under 12 acres, capture a reason.
--     Written by internal staff or the pilot's vendor now (pilots themselves
--     later); read into the Client and Vendor portals. Helps close locations
--     and deactivate pilots/vendors on time.
-- (B) CLIENT POCs: authorise several email logins per client; all share the
--     client's assigned locations (party_id = clients.id).
-- Reuses external-auth helpers (sql/65) + client_locations (sql/92). Additive.
-- ============================================================================

-- Locations a VENDOR is (or was) working, via its pilots' assignments.
create or replace function public.my_vendor_location_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct pa.location_id
    from public.pilot_assignments pa
    join public.pilots p on p.id = pa.pilot_id
   where p.vendor_id = public.my_vendor_id();
$$;
grant execute on function public.my_vendor_location_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- (A) short_day_logs — one reason per pilot-day (date + location + pilot label)
-- ---------------------------------------------------------------------------
create table if not exists public.short_day_logs (
  id           uuid primary key default gen_random_uuid(),
  entry_date   date not null,
  location_id  uuid references public.spray_locations(id),
  location_name text,
  pilot_name   text not null default '(unassigned)',
  vendor_id    uuid references public.vendors(id),
  acres        numeric,
  reason       text,
  recorded_by  uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (entry_date, location_id, pilot_name)
);
create index if not exists sdl_loc_idx on public.short_day_logs(location_id, entry_date);
alter table public.short_day_logs enable row level security;

-- Reads: internal all; client for its assigned locations; vendor for its locations.
-- Writes go through set_short_day_reason() (security definer), so no write policy.
drop policy if exists sdl_internal_sel on public.short_day_logs;
create policy sdl_internal_sel on public.short_day_logs for select to authenticated
  using (public.is_internal());
drop policy if exists sdl_client_sel on public.short_day_logs;
create policy sdl_client_sel on public.short_day_logs for select to authenticated
  using (location_id in (select cl.location_id from public.client_locations cl where cl.client_id = public.my_client_id()));
drop policy if exists sdl_vendor_sel on public.short_day_logs;
create policy sdl_vendor_sel on public.short_day_logs for select to authenticated
  using (location_id in (select public.my_vendor_location_ids()));
grant select on public.short_day_logs to authenticated;

-- Shared short-day aggregation for a set of locations (approved rows, <12 acres).
-- p_scope: 'internal' (all), 'client' (my client locations), 'vendor' (my vendor locations).
create or replace function public.short_days(p_scope text default 'internal', p_from date default null, p_to date default null)
returns table(entry_date date, location_id uuid, location_name text, pilot_name text, acres numeric, reason text, log_id uuid)
language sql stable security definer set search_path = public as $$
  with scope as (
    select case
      when p_scope='client' then (public.my_client_id() is not null)
      when p_scope='vendor' then (public.my_vendor_id() is not null)
      else public.is_internal() end as ok
  ), agg as (
    select a.entry_date, a.location_id, l.name as location_name,
           coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)') as pilot_name,
           round(sum(a.acres),2) as acres
      from public.acre_entries a
      join public.spray_locations l on l.id = a.location_id
      left join public.pilots p on p.id = a.pilot_id
     where coalesce(a.approval_status,'approved') = 'approved'
       and (select ok from scope)
       and (p_scope='internal'
            or (p_scope='client' and a.location_id in (select cl.location_id from public.client_locations cl where cl.client_id = public.my_client_id()))
            or (p_scope='vendor' and a.location_id in (select public.my_vendor_location_ids())))
       and a.entry_date >= coalesce(p_from, current_date - 45)
       and (p_to is null or a.entry_date <= p_to)
     group by a.entry_date, a.location_id, l.name,
              coalesce(p.name, nullif(btrim(a.pilot_name),''), '(unassigned)')
    having round(sum(a.acres),2) < 12
  )
  select agg.entry_date, agg.location_id, agg.location_name, agg.pilot_name, agg.acres,
         sdl.reason, sdl.id
    from agg
    left join public.short_day_logs sdl
      on sdl.entry_date = agg.entry_date and sdl.location_id = agg.location_id and sdl.pilot_name = agg.pilot_name
   order by agg.entry_date desc, agg.location_name, agg.pilot_name;
$$;
grant execute on function public.short_days(text, date, date) to authenticated;

-- Record / update a short-day reason (internal, or the vendor for that location).
create or replace function public.set_short_day_reason(
  p_date date, p_location uuid, p_pilot_name text, p_acres numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_vendor uuid := public.my_vendor_id();
begin
  if not (public.is_internal() or p_location in (select public.my_vendor_location_ids())) then
    raise exception 'Not permitted to record a reason for this location';
  end if;
  insert into public.short_day_logs(entry_date, location_id, location_name, pilot_name, vendor_id, acres, reason, recorded_by)
  values (p_date, p_location, (select name from public.spray_locations where id = p_location),
          coalesce(nullif(btrim(p_pilot_name),''),'(unassigned)'),
          case when v_vendor is not null then v_vendor else null end,
          p_acres, p_reason, auth.uid())
  on conflict (entry_date, location_id, pilot_name) do update
     set reason = excluded.reason,
         acres = coalesce(excluded.acres, public.short_day_logs.acres),
         vendor_id = coalesce(public.short_day_logs.vendor_id, excluded.vendor_id),
         recorded_by = auth.uid(), updated_at = now();
end $$;
grant execute on function public.set_short_day_reason(date, uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- (B) client_pocs — extra portal logins for a client (multiple contacts)
--     Each POC's login is created via the admin-users edge fn with
--     party_id = clients.id, so they all see the client's assigned locations.
-- ---------------------------------------------------------------------------
create table if not exists public.client_pocs (
  client_id  uuid not null references public.clients(id) on delete cascade,
  email      text not null,
  name       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (client_id, email)
);
create unique index if not exists client_pocs_email_uidx on public.client_pocs(lower(email));
alter table public.client_pocs enable row level security;
drop policy if exists client_pocs_internal on public.client_pocs;
create policy client_pocs_internal on public.client_pocs for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
grant select, insert, update, delete on public.client_pocs to authenticated;
