-- ============================================================================
-- DroCon Cloud — Partner Portal (#3/#4)
-- Invite-only EXTERNAL logins for Consultants and Authorized Partners so they
-- can submit invoices (acres sprayed / consultancy timesheet) and seek payment.
-- Managers review/approve/pay internally.
--
-- Security model:
--   * External users get profiles.is_external = true. The front-end shows them
--     only the Partner Portal; the DB is the hard boundary — every internal
--     team table's read/insert/update now requires public.is_internal(), so an
--     external login can NEVER read internal data via the API.
--   * Self sign-up is still domain-restricted (droconbharat.com / ibsideas.com)
--     EXCEPT for emails an admin has pre-invited (partner_invites) — those become
--     external partner accounts automatically on first sign-up.
-- Safe to re-run (idempotent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — external flag + link to the consultant / authorized-partner row
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_external boolean not null default false;
alter table public.profiles add column if not exists party_type  text;     -- 'consultant' | 'authorized_partner'
alter table public.profiles add column if not exists party_id    uuid;

-- ---------------------------------------------------------------------------
-- 2. Helper functions (SECURITY DEFINER — bypass RLS to read profiles safely)
-- ---------------------------------------------------------------------------
create or replace function public.is_external()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.is_external = true);
$$;

create or replace function public.is_internal()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid()
                and coalesce(p.is_external,false) = false);
$$;

-- managers who may review/approve/pay portal invoices: admins OR holders of the
-- 'partner_invoices' app permission.
create or replace function public.has_portal_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists(select 1 from public.app_permissions ap
                where ap.user_id = auth.uid() and ap.tool_key = 'partner_invoices');
$$;

-- ---------------------------------------------------------------------------
-- 3. partner_invites — admin pre-authorises an external email + links the party
-- ---------------------------------------------------------------------------
create table if not exists public.partner_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  party_type  text not null,                  -- 'consultant' | 'authorized_partner'
  party_id    uuid,                            -- employees.id (consultant) or authorized_partners.id
  party_name  text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  used_by     uuid
);
create unique index if not exists partner_invites_email_open
  on public.partner_invites(lower(email)) where used_at is null;

alter table public.partner_invites enable row level security;
drop policy if exists partner_invites_admin on public.partner_invites;
create policy partner_invites_admin on public.partner_invites for all to authenticated
  using (public.has_portal_admin()) with check (public.has_portal_admin());
grant select, insert, update, delete on public.partner_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 4. partner_rates — the Authorized-Partner billing/commission slabs
--    (replicated from the Authorized Partner agreement "Billing Rates" annexure)
-- ---------------------------------------------------------------------------
create table if not exists public.partner_rates (
  id          uuid primary key default gen_random_uuid(),
  party_type  text not null default 'authorized_partner',
  slab        text,            -- "Up to ₹400/- per acre"
  rate_upto   numeric,         -- upper bound of the slab (₹/acre); null = open-ended top slab
  partner_pct numeric,         -- % of the acre rate paid to the partner
  drocon_pct  numeric,         -- DroCon Bharat's retained commission %
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
-- seed the standard slabs once (only if the table is empty)
insert into public.partner_rates (party_type, slab, rate_upto, partner_pct, drocon_pct)
select * from (values
  ('authorized_partner','Up to ₹350/- per acre',         350::numeric, 95::numeric,  5::numeric),
  ('authorized_partner','Up to ₹400/- per acre',         400::numeric, 93::numeric,  7::numeric),
  ('authorized_partner','Up to ₹450/- per acre',         450::numeric, 90::numeric, 10::numeric),
  ('authorized_partner','₹451/- & above per acre',       null::numeric,85::numeric, 15::numeric)
) v(party_type,slab,rate_upto,partner_pct,drocon_pct)
where not exists (select 1 from public.partner_rates);

alter table public.partner_rates enable row level security;
-- readable by everyone signed in (incl. external partners, so they see their rates)
drop policy if exists partner_rates_read on public.partner_rates;
create policy partner_rates_read on public.partner_rates for select to authenticated using (true);
drop policy if exists partner_rates_write on public.partner_rates;
create policy partner_rates_write on public.partner_rates for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));
grant select, insert, update, delete on public.partner_rates to authenticated;

-- ---------------------------------------------------------------------------
-- 5. partner_invoices — submitted by externals, approved/paid by managers
-- ---------------------------------------------------------------------------
create table if not exists public.partner_invoices (
  id               uuid primary key default gen_random_uuid(),
  party_type       text not null,                 -- 'consultant' | 'authorized_partner'
  party_id         uuid,
  party_name       text,
  submitted_by     uuid references public.profiles(id),
  invoice_number   text,
  period           text,                          -- free text, e.g. 'Jun 2026'
  line_items       jsonb not null default '[]',   -- AP: [{date,farmer,mobile,rate,acre,amount,comm_rate,comm_amount}]
                                                  -- consultant: [{date,description,hours,rate,amount}]
  gross            numeric,
  commission_total numeric,
  net_payable      numeric,
  status           text not null default 'submitted',  -- submitted|approved|rejected|paid
  approver         uuid references public.profiles(id),
  approved_at      timestamptz,
  paid_at          timestamptz,
  manager_note     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists partner_invoices_submitter on public.partner_invoices(submitted_by);
create index if not exists partner_invoices_status    on public.partner_invoices(status);

alter table public.partner_invoices enable row level security;
-- read: own (external submitter) OR any portal manager
drop policy if exists partner_invoices_read on public.partner_invoices;
create policy partner_invoices_read on public.partner_invoices for select to authenticated
  using (submitted_by = auth.uid() or public.has_portal_admin());
-- insert: an external user files their own; managers may also create on behalf
drop policy if exists partner_invoices_insert on public.partner_invoices;
create policy partner_invoices_insert on public.partner_invoices for insert to authenticated
  with check (submitted_by = auth.uid() or public.has_portal_admin());
-- update: submitter may edit only while still 'submitted'; managers may always
drop policy if exists partner_invoices_update on public.partner_invoices;
create policy partner_invoices_update on public.partner_invoices for update to authenticated
  using ((submitted_by = auth.uid() and status = 'submitted') or public.has_portal_admin())
  with check (submitted_by = auth.uid() or public.has_portal_admin());
-- delete: submitter while 'submitted', or a manager
drop policy if exists partner_invoices_delete on public.partner_invoices;
create policy partner_invoices_delete on public.partner_invoices for delete to authenticated
  using ((submitted_by = auth.uid() and status = 'submitted') or public.has_portal_admin());
grant select, insert, update, delete on public.partner_invoices to authenticated;

-- ---------------------------------------------------------------------------
-- 6. HARD BOUNDARY — internal team tables become internal-only.
--    External (is_external) logins can no longer read/write any of these.
--    (Deletes are already admin/owner-gated, which externals can never satisfy.)
-- ---------------------------------------------------------------------------
-- Only the genuinely team-readable (was `using(true)`) tables are touched here.
-- HR tables (employees/salary_*/accounting_entries) and farmer_sprays already use
-- has_hr_access()/has_farmer_access() — externals satisfy neither, so they are
-- already blocked. agreements/template_overrides use creator/role visibility — an
-- external 'drafter' owns nothing, so reads nothing. We leave all those untouched.
do $$
declare t text;
begin
  foreach t in array array['clients','vendors','authorized_partners','service_catalogue',
                           'spare_catalogue','inventory','inventory_moves','documents','payments',
                           'bom_designs','spray_locations','acre_entries','potential_orders','resources']
  loop
    if to_regclass('public.'||t) is null then continue; end if;
    begin
      execute format('alter table public.%I enable row level security;', t);
      execute format('drop policy if exists %I_read on public.%I;', t, t);
      execute format('create policy %I_read on public.%I for select to authenticated using (public.is_internal());', t, t);
      execute format('drop policy if exists %I_insert on public.%I;', t, t);
      execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.is_internal());', t, t);
      execute format('drop policy if exists %I_update on public.%I;', t, t);
      execute format('create policy %I_update on public.%I for update to authenticated using (public.is_internal());', t, t);
    exception when others then
      raise notice 'partner portal: skipped % (%):', t, sqlerrm;
    end;
  end loop;
end $$;

-- profiles: an external user may read ONLY their own profile (not the staff list).
-- Internal users keep full read (Team & Access, approver pickers need it).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_internal());

-- ---------------------------------------------------------------------------
-- 7. handle_new_user — honour invites (bypass domain restriction for invitees)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first     boolean;
  email_domain text := lower(split_part(new.email,'@',2));
  allowed      text[] := array['droconbharat.com','ibsideas.com'];
  inv          public.partner_invites%rowtype;
begin
  -- pre-invited external partner?
  select * into inv from public.partner_invites
    where lower(email) = lower(new.email) and used_at is null
    order by created_at desc limit 1;

  if inv.id is not null then
    insert into public.profiles (id, email, full_name, role, is_external, party_type, party_id)
    values (
      new.id, new.email,
      coalesce(new.raw_user_meta_data->>'full_name', inv.party_name, split_part(new.email,'@',1)),
      'drafter'::user_role, true, inv.party_type, inv.party_id
    );
    update public.partner_invites set used_at = now(), used_by = new.id where id = inv.id;
    return new;
  end if;

  -- otherwise: internal staff, domain-restricted
  if not (email_domain = any(allowed)) then
    raise exception 'Sign-ups are restricted to % email addresses (or an admin invite).', array_to_string(allowed,' or @');
  end if;

  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when is_first then 'admin'::user_role else 'drafter'::user_role end
  );
  return new;
end $$;

-- ============================================================================
-- Done. After running: an admin adds a partner_invite (via Partners → Consultant
-- or Authorized Partner → "Invite login"), the partner self-signs-up with that
-- email, and lands in the Partner Portal to submit invoices.
-- ============================================================================
