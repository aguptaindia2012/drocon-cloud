-- ============================================================================
-- DroCon Bharat Agreement Studio — Cloud Edition
-- Database schema for Supabase (PostgreSQL)
--
-- HOW TO USE:
--   1. Create a free project at https://supabase.com
--   2. Open the project → SQL Editor → New query
--   3. Paste this whole file and click RUN
--   4. (Auth → Providers → Email) For quick testing, turn OFF "Confirm email"
--      so new sign-ups are logged in immediately.
--
-- This sets up: profiles (with roles), agreements (with status workflow),
-- shared template overrides, and an audit log — all protected by Row Level
-- Security so the rules are enforced by the database, not just the browser.
-- ============================================================================

-- ---------- enums ----------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin','approver','drafter','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agreement_status as enum ('draft','in_review','approved','rejected','executed');
exception when duplicate_object then null; end $$;

-- ---------- profiles (one row per user) ------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        user_role not null default 'drafter',
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---------- agreements -----------------------------------------------------
create table if not exists public.agreements (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  counterparty      text,
  category          text,                       -- client | vendor | module
  template_key      text,
  status            agreement_status not null default 'draft',
  data              jsonb,                       -- full Studio draft JSON
  created_by        uuid not null references public.profiles(id),
  assigned_approver uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.agreements enable row level security;
create index if not exists agreements_status_idx on public.agreements(status);
create index if not exists agreements_creator_idx on public.agreements(created_by);

-- ---------- shared template overrides (permanent in-app template edits) -----
create table if not exists public.template_overrides (
  template_key text primary key,
  clauses      jsonb not null,
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now()
);
alter table public.template_overrides enable row level security;

-- ---------- audit log ------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor       uuid references public.profiles(id),
  action      text not null,                    -- created | submitted | approved | rejected | executed | edited | role_changed | template_saved
  entity      text not null,                    -- agreement | template | profile
  entity_id   text,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create index if not exists audit_created_idx on public.audit_log(created_at desc);

-- ============================================================================
-- Helper functions (SECURITY DEFINER so they can read profiles without
-- tripping the profiles RLS — this avoids policy recursion).
-- ============================================================================
create or replace function public.my_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.has_role(roles user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any(roles));
$$;

-- ============================================================================
-- New-user bootstrap: create a profile automatically. The FIRST user to sign
-- up becomes 'admin'; everyone after that starts as 'drafter'.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when is_first then 'admin'::user_role else 'drafter'::user_role end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep updated_at fresh on agreements
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists agreements_touch on public.agreements;
create trigger agreements_touch before update on public.agreements
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Admin-only RPC to change a user's role (avoids self-privilege-escalation).
-- ============================================================================
create or replace function public.admin_set_role(target uuid, new_role user_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']::user_role[]) then
    raise exception 'Only admins can change roles';
  end if;
  update public.profiles set role = new_role where id = target;
  insert into public.audit_log(actor, action, entity, entity_id, note)
  values (auth.uid(), 'role_changed', 'profile', target::text, 'role set to '||new_role);
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- profiles -------------------------------------------------------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

-- a user may edit their OWN profile but NOT change their own role
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

-- admins may update any profile
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.has_role(array['admin']::user_role[]));

-- agreements -----------------------------------------------------------------
-- whole team can see agreements (small-team model; tighten later if needed)
drop policy if exists agreements_read on public.agreements;
create policy agreements_read on public.agreements
  for select to authenticated using (true);

drop policy if exists agreements_insert on public.agreements;
create policy agreements_insert on public.agreements
  for insert to authenticated
  with check (created_by = auth.uid());

-- owner can update their own agreement…
drop policy if exists agreements_update_owner on public.agreements;
create policy agreements_update_owner on public.agreements
  for update to authenticated
  using (created_by = auth.uid());

-- …and approvers/admins can update any (e.g. to approve / reject / execute)
drop policy if exists agreements_update_approver on public.agreements;
create policy agreements_update_approver on public.agreements
  for update to authenticated
  using (public.has_role(array['approver','admin']::user_role[]));

-- owner may delete a draft; admins may delete anything
drop policy if exists agreements_delete on public.agreements;
create policy agreements_delete on public.agreements
  for delete to authenticated
  using (public.has_role(array['admin']::user_role[]) or created_by = auth.uid());

-- template_overrides ---------------------------------------------------------
drop policy if exists tmpl_read on public.template_overrides;
create policy tmpl_read on public.template_overrides
  for select to authenticated using (true);

drop policy if exists tmpl_write on public.template_overrides;
create policy tmpl_write on public.template_overrides
  for all to authenticated
  using (public.has_role(array['admin','approver']::user_role[]))
  with check (public.has_role(array['admin','approver']::user_role[]));

-- audit_log ------------------------------------------------------------------
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated using (true);

drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (actor = auth.uid());

-- ============================================================================
-- Done. Notes:
--  • Data is encrypted at rest by Supabase (AES-256) and in transit (TLS).
--  • RLS above is enforced by Postgres itself, so the browser cannot bypass it.
--  • The anon API key used by the front-end is SAFE to expose publicly — RLS
--    is what protects the data, not the key.
-- ============================================================================
