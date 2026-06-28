-- ============================================================================
-- DroCon Cloud — ALL-IN-ONE setup script
-- Paste this whole file into Supabase → SQL Editor → New query → RUN.
-- It runs migrations 00→04 in order. Safe to re-run (idempotent guards).
-- ============================================================================


-- ####################################################################
-- ## 00_schema_agreements.sql
-- ####################################################################

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


-- ####################################################################
-- ## 01_migrate_v2.sql
-- ####################################################################

-- ============================================================================
-- DroCon Bharat Agreement Studio — Cloud, migration v2
-- Adds: separation of duties, two-level approval, and notifications.
-- Safe to run once on your existing project (SQL Editor → paste → Run).
-- Click through the "destructive operations" notice — it only changes YOUR schema.
-- ============================================================================

-- 1) Allow a new "recommended" status. We switch status to TEXT (+ check) so we
--    can evolve states without enum-migration friction.
alter table public.agreements alter column status drop default;
alter table public.agreements alter column status type text using status::text;
alter table public.agreements alter column status set default 'draft';
do $$ begin
  alter table public.agreements add constraint agreements_status_chk
    check (status in ('draft','in_review','recommended','approved','rejected','executed'));
exception when duplicate_object then null; end $$;

-- 2) Notifications -----------------------------------------------------------
create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  agreement_id uuid references public.agreements(id) on delete cascade,
  type         text,
  message      text not null,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.notifications enable row level security;
create index if not exists notif_user_idx on public.notifications(user_id, is_read, created_at desc);

drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on public.notifications to authenticated;

-- helper: write a notification (used inside the SECURITY DEFINER RPCs below)
create or replace function public.notify(p_user uuid, p_ag uuid, p_type text, p_msg text)
returns void language sql security definer set search_path=public as $$
  insert into public.notifications(user_id, agreement_id, type, message)
  select p_user, p_ag, p_type, p_msg where p_user is not null;
$$;

-- ============================================================================
-- 3) Workflow RPCs. All rules live here, enforced by the database.
-- ============================================================================

-- Submit a draft for review (preparer only)
create or replace function public.submit_for_review(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; r record;
begin
  select * into ag from public.agreements where id = p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  if ag.created_by <> auth.uid() then raise exception 'Only the preparer can submit this agreement'; end if;
  if ag.status not in ('draft','rejected') then raise exception 'Only a draft can be submitted'; end if;

  update public.agreements set status='in_review' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'submitted','agreement',p_id::text, coalesce(p_note,'Submitted for review'));

  -- notify the assigned approver, or (if none) every approver/admin
  if ag.assigned_approver is not null then
    perform public.notify(ag.assigned_approver, p_id, 'review', 'An agreement "'||ag.title||'" is awaiting your review.');
  else
    for r in select id from public.profiles where role in ('approver','admin') and id <> auth.uid() loop
      perform public.notify(r.id, p_id, 'review', 'An agreement "'||ag.title||'" is awaiting review.');
    end loop;
  end if;
end $$;

-- Approve. Admin = final approval. Non-admin approver = "recommend" (needs admin).
create or replace function public.approve_agreement(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role; r record;
begin
  select * into ag from public.agreements where id=p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'You are not authorised to approve'; end if;
  -- separation of duties: a preparer cannot approve their own work unless they are an admin
  if ag.created_by = auth.uid() and v_role <> 'admin' then
    raise exception 'The preparer cannot approve their own agreement';
  end if;

  if v_role = 'admin' and ag.status in ('in_review','recommended') then
    update public.agreements set status='approved' where id=p_id;
    insert into public.audit_log(actor,action,entity,entity_id,note)
      values (auth.uid(),'approved','agreement',p_id::text, coalesce(p_note,'Approved (final)'));
    perform public.notify(ag.created_by, p_id, 'approved', 'Your agreement "'||ag.title||'" has been approved.');
    -- also tell any approver who recommended it
    for r in select distinct actor from public.audit_log where entity='agreement' and entity_id=p_id::text and action='recommended' loop
      perform public.notify(r.actor, p_id, 'approved', 'The agreement "'||ag.title||'" you reviewed has been approved by an admin.');
    end loop;

  elsif v_role = 'approver' and ag.status = 'in_review' then
    update public.agreements set status='recommended' where id=p_id;
    insert into public.audit_log(actor,action,entity,entity_id,note)
      values (auth.uid(),'recommended','agreement',p_id::text, coalesce(p_note,'Recommended — awaiting admin approval'));
    -- notify all admins (they must finalise) and the preparer (status update)
    for r in select id from public.profiles where role='admin' loop
      perform public.notify(r.id, p_id, 'final_needed', 'Agreement "'||ag.title||'" was recommended and needs your final approval.');
    end loop;
    perform public.notify(ag.created_by, p_id, 'recommended', 'Your agreement "'||ag.title||'" was reviewed and recommended; awaiting admin approval.');

  elsif v_role = 'approver' and ag.status = 'recommended' then
    raise exception 'Already recommended — awaiting an admin for final approval';
  else
    raise exception 'Cannot approve from the current status (%).', ag.status;
  end if;
end $$;

-- Reject (approver/admin; not your own work unless admin)
create or replace function public.reject_agreement(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role; r record;
begin
  select * into ag from public.agreements where id=p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'You are not authorised to reject'; end if;
  if ag.created_by = auth.uid() and v_role <> 'admin' then raise exception 'The preparer cannot reject their own agreement'; end if;
  if ag.status not in ('in_review','recommended') then raise exception 'Only an item under review can be rejected'; end if;

  update public.agreements set status='rejected' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'rejected','agreement',p_id::text, coalesce(p_note,'Rejected'));
  perform public.notify(ag.created_by, p_id, 'rejected', 'Your agreement "'||ag.title||'" was returned with changes requested.'||case when p_note is not null then ' Note: '||p_note else '' end);
  for r in select distinct actor from public.audit_log where entity='agreement' and entity_id=p_id::text and action='recommended' loop
    perform public.notify(r.actor, p_id, 'rejected', 'The agreement "'||ag.title||'" you recommended was rejected.');
  end loop;
end $$;

-- Mark executed (signed) — approver/admin, after final approval
create or replace function public.mark_executed(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role;
begin
  select * into ag from public.agreements where id=p_id;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'Not authorised'; end if;
  if ag.status <> 'approved' then raise exception 'Only an approved agreement can be marked executed'; end if;
  update public.agreements set status='executed' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'executed','agreement',p_id::text, coalesce(p_note,'Marked executed (signed)'));
  perform public.notify(ag.created_by, p_id, 'executed', 'Your agreement "'||ag.title||'" has been marked executed.');
end $$;

grant execute on function public.submit_for_review(uuid,text) to authenticated;
grant execute on function public.approve_agreement(uuid,text) to authenticated;
grant execute on function public.reject_agreement(uuid,text) to authenticated;
grant execute on function public.mark_executed(uuid,text) to authenticated;
grant execute on function public.notify(uuid,uuid,text,text) to authenticated;

-- ============================================================================
-- Done. Statuses now flow:
--   draft → in_review → (recommended) → approved → executed
--                         ↑ non-admin approver        ↑ admin only
--   any review step → rejected → back to draft owner
-- Separation of duties and "non-admin approvals need an admin" are enforced above.
-- ============================================================================


-- ####################################################################
-- ## 02_migrate_v3_visibility.sql
-- ####################################################################

-- ============================================================================
-- DroCon Bharat Agreement Studio — Cloud, migration v3 (visibility)
-- Restricts who can SEE agreements:
--   • a drafter/viewer sees only agreements they created or are assigned to approve
--   • approvers and admins see everything (so they can review)
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================

drop policy if exists agreements_read on public.agreements;

create policy agreements_read on public.agreements
  for select to authenticated
  using (
    created_by = auth.uid()
    or assigned_approver = auth.uid()
    or public.has_role(array['approver','admin']::user_role[])
  );

-- Note: the INSERT/UPDATE/DELETE policies are unchanged. This only affects
-- which rows each person can read. To go back to full shared visibility, run:
--   drop policy if exists agreements_read on public.agreements;
--   create policy agreements_read on public.agreements
--     for select to authenticated using (true);


-- ####################################################################
-- ## 03_migrate_v4_ops.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — Operations Suite (v4)
-- Additive migration: registries, catalogues, inventory, documents, payments,
-- BOM designs, field trackers, potential orders, and per-tool permissions.
--
-- HOW TO USE:
--   Run AFTER 00_schema_agreements.sql, 01_migrate_v2.sql, 02_migrate_v3_visibility.sql.
--   Open Supabase → SQL Editor → paste this whole file → RUN.
--
-- RLS model (small-team): every authenticated user can READ all rows; any
-- authenticated user can INSERT/UPDATE (the front-end gates *which tools* they
-- see via app_permissions); only the creator or an admin can DELETE. Tighten
-- later if needed. Helper functions my_role()/has_role() come from the base schema.
-- ============================================================================

-- ---------- generic helpers -------------------------------------------------
create or replace function public.touch_updated_at_ops()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Convenience: standard team-read + team-write + owner/admin-delete policy set.
-- (Written out per table below for clarity / so each can be tuned independently.)

-- ============================================================================
-- 1. CLIENTS  (pulled into Invoice / Credit Note)
-- ============================================================================
create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,           -- contact / display name
  firm_name      text,                    -- Firm/Buyer Name on the invoice
  gstin          text,                    -- GSTIN/UIN (or 'URP')
  address        text,
  city           text,
  state          text,
  state_code     text,
  pincode        text,
  mobile         text,
  email          text,
  contact_person text,
  client_type    text,                    -- Key Client | Normal | ...
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================================
-- 2. VENDORS  (pulled into Purchase Order) — replicates the client tracker
-- ============================================================================
create table if not exists public.vendors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  firm_name      text,
  gstin          text,
  address        text,
  city           text,
  state          text,
  state_code     text,
  pincode        text,
  country        text default 'India',    -- supports overseas (e.g. China) vendors
  currency       text default 'INR',
  mobile         text,
  email          text,
  contact_person text,
  default_terms  text,                     -- default PO terms for this vendor
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================================
-- 3. AUTHORIZED PARTNERS (pilots / drone-owning companies) — pool + search
-- ============================================================================
create table if not exists public.authorized_partners (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  company           text,
  phone             text,
  email             text,
  home_state        text,
  home_district     text,
  home_lat          double precision,
  home_lng          double precision,
  drone_model       text,
  battery           text,
  capacity_acres_day numeric,
  rates             jsonb,                 -- {short:400, tall:500, ...}
  source            text default 'manual', -- 'manual' | 'agreement'
  agreement_id      uuid references public.agreements(id),
  notes             text,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================================
-- 4. SERVICE CATALOGUE  (line-item source for services)
-- ============================================================================
create table if not exists public.service_catalogue (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  hsn_sac       text,
  unit          text default 'Acre',
  default_rate  numeric,
  gst_rate      numeric default 0,         -- percent
  description   text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================================
-- 5. SPARE CATALOGUE  (line-item source for goods) + INVENTORY
-- ============================================================================
create table if not exists public.spare_catalogue (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  hsn_code      text,
  unit          text,
  rate_excl_gst numeric,
  gst_rate      numeric default 5,
  description   text,
  current_stock numeric default 0,         -- denormalised running stock
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.inventory_moves (
  id          bigint generated always as identity primary key,
  spare_id    uuid references public.spare_catalogue(id) on delete cascade,
  qty         numeric not null,            -- positive number
  direction   text not null check (direction in ('in','out')),
  reason      text,                        -- purchase | sale | adjustment | ...
  ref_doc_id  uuid,                         -- FK to documents added after that table exists
  moved_on    date not null default current_date,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

-- keep current_stock in sync with moves
create or replace function public.apply_inventory_move()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.spare_catalogue
      set current_stock = coalesce(current_stock,0) + (case when new.direction='in' then new.qty else -new.qty end),
          updated_at = now()
      where id = new.spare_id;
  elsif (tg_op = 'DELETE') then
    update public.spare_catalogue
      set current_stock = coalesce(current_stock,0) - (case when old.direction='in' then old.qty else -old.qty end),
          updated_at = now()
      where id = old.spare_id;
  end if;
  return null;
end $$;
drop trigger if exists inv_move_apply on public.inventory_moves;
create trigger inv_move_apply after insert or delete on public.inventory_moves
  for each row execute function public.apply_inventory_move();

-- ============================================================================
-- 6. DOCUMENTS  (quotation | invoice | credit_note | purchase_order)
-- ============================================================================
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  doc_type       text not null check (doc_type in ('quotation','invoice','credit_note','purchase_order')),
  number         text not null,            -- e.g. DCB/26-27/0023 or DCB26-270002
  fiscal_year    text,                     -- e.g. 26-27
  seq            integer,                  -- numeric part for next-number logic
  doc_date       date not null default current_date,
  party_kind     text,                     -- client | vendor | none
  party_id       uuid,                     -- clients.id or vendors.id (no FK: polymorphic)
  party_snapshot jsonb,                    -- frozen buyer/supplier block at issue time
  line_items     jsonb not null default '[]',
  totals         jsonb,                    -- {sub, gst, total, in_words}
  terms          jsonb,                    -- {payment, delivery, po_terms[]...}
  status         text not null default 'draft', -- draft|issued|paid|partial|cancelled
  related_doc_id uuid references public.documents(id), -- credit_note -> invoice
  data           jsonb,                    -- full editable draft (for re-open + JSON)
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists documents_type_idx on public.documents(doc_type);
create index if not exists documents_party_idx on public.documents(party_id);
-- number uniqueness is created in the 13 section as (doc_type, entity, number).

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before update on public.documents
  for each row execute function public.touch_updated_at_ops();

-- now that documents exists, link inventory moves to source documents
do $$ begin
  alter table public.inventory_moves
    add constraint inventory_moves_ref_doc_fk
    foreign key (ref_doc_id) references public.documents(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Next-number suggestion. Returns the next sequence integer for a doc_type+FY.
create or replace function public.next_doc_seq(p_doc_type text, p_fy text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(max(seq),0) + 1
  from public.documents
  where doc_type = p_doc_type and coalesce(fiscal_year,'') = coalesce(p_fy,'');
$$;

-- ============================================================================
-- 7. PAYMENTS (receivables) — against invoices
-- ============================================================================
create table if not exists public.payments (
  id          bigint generated always as identity primary key,
  document_id uuid references public.documents(id) on delete cascade,
  amount      numeric not null,
  paid_on     date not null default current_date,
  mode        text,                         -- UPI | NEFT | Cash | Cheque
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists payments_doc_idx on public.payments(document_id);

-- ============================================================================
-- 8. BOM DESIGNS (Drone Quotations Builder)
-- ============================================================================
create table if not exists public.bom_designs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  parts          jsonb not null default '[]',  -- [{part, qty, rate_excl, gst_rate}]
  overhead_pct   numeric default 15,
  profit_pct     numeric default 10,
  commission_pct numeric default 2,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================================
-- 9. FIELD TRACKERS (Phase 2) — created now so the schema is stable
-- ============================================================================
create table if not exists public.spray_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  state       text,
  district    text,
  client_id   uuid references public.clients(id),
  rates       jsonb,                         -- {default:300, ...} multiple rates ok
  created_at  timestamptz not null default now()
);

create table if not exists public.acre_entries (
  id          bigint generated always as identity primary key,
  entry_date  date not null,
  location_id uuid references public.spray_locations(id),
  pilot_id    uuid references public.authorized_partners(id),
  pilot_name  text,                           -- denormalised for legacy import
  acres       numeric not null default 0,
  rate        numeric,
  amount      numeric,
  crop        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists acre_date_idx on public.acre_entries(entry_date);

create table if not exists public.farmer_sprays (
  id               bigint generated always as identity primary key,
  spray_date       date not null,
  pilot_name       text,
  client_name      text,
  farmer_name      text,
  contact_no       text,
  village          text,
  city             text,
  state            text,
  chemical_company text,
  crop             text,
  acre             numeric,
  rate             numeric,
  amount           numeric,
  gps_image_present boolean not null default false,
  gps_image_url    text,
  invoice_number   text,
  payment_status   text,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);
create index if not exists farmer_date_idx on public.farmer_sprays(spray_date);

-- ============================================================================
-- 10. POTENTIAL ORDERS (Order Tracker pool)
-- ============================================================================
create table if not exists public.potential_orders (
  id               uuid primary key default gen_random_uuid(),
  client_name      text not null,
  client_phone     text,
  referral_agent   text,
  status           text,                      -- New Client | Work Completed | ...
  state            text,
  city             text,
  location         text,
  crop             text,
  start_month      text,
  end_month        text,
  start_date       date,                      -- parsed for the 15-day follow-up
  gross_rate       numeric,
  commission       numeric,
  avg_daily_order  numeric,
  client_pref      text,
  order_pref       text,
  notes            text,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- 11. PER-TOOL PERMISSIONS
-- ============================================================================
create table if not exists public.app_permissions (
  user_id    uuid references public.profiles(id) on delete cascade,
  tool_key   text not null,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, tool_key)
);

create or replace function public.admin_set_permission(target uuid, p_tool text, p_grant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']::user_role[]) then
    raise exception 'Only admins can change tool access';
  end if;
  if p_grant then
    insert into public.app_permissions(user_id, tool_key, granted_by)
    values (target, p_tool, auth.uid())
    on conflict (user_id, tool_key) do nothing;
  else
    delete from public.app_permissions where user_id = target and tool_key = p_tool;
  end if;
end $$;

-- ============================================================================
-- updated_at triggers for the master tables
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['clients','vendors','authorized_partners','service_catalogue',
                           'spare_catalogue','bom_designs','potential_orders']
  loop
    execute format('drop trigger if exists %I_touch on public.%I;', t, t);
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function public.touch_updated_at_ops();', t, t);
  end loop;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY — team-read, team-write, owner/admin-delete
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['clients','vendors','authorized_partners','service_catalogue',
                           'spare_catalogue','inventory_moves','documents','payments',
                           'bom_designs','spray_locations','acre_entries','farmer_sprays',
                           'potential_orders']
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true);', t, t);

    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (true);', t, t);

    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (true);', t, t);
  end loop;
end $$;

-- deletes: creator or admin (tables that carry created_by)
do $$
declare t text;
begin
  foreach t in array array['clients','vendors','authorized_partners','documents',
                           'bom_designs','potential_orders','acre_entries','farmer_sprays']
  loop
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated
                    using (public.has_role(array[''admin'']::user_role[]) or created_by = auth.uid());', t, t);
  end loop;
  -- catalogues / inventory / payments / locations: admin or approver may delete
  foreach t in array array['service_catalogue','spare_catalogue','inventory_moves','payments','spray_locations']
  loop
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated
                    using (public.has_role(array[''admin'',''approver'']::user_role[]));', t, t);
  end loop;
end $$;

-- app_permissions: a user reads their own; admins read/write all
alter table public.app_permissions enable row level security;
drop policy if exists appperm_read_self on public.app_permissions;
create policy appperm_read_self on public.app_permissions
  for select to authenticated using (user_id = auth.uid() or public.has_role(array['admin']::user_role[]));
drop policy if exists appperm_admin_all on public.app_permissions;
create policy appperm_admin_all on public.app_permissions
  for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));

-- ============================================================================
-- Done. Run seed_catalogues.sql next to load the spare + service catalogues.
-- ============================================================================


-- ####################################################################
-- ## 04_seed_catalogues.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — seed data for Service & Spare catalogues + a default BOM.
-- Safe to re-run: guarded by NOT EXISTS on name.
-- Run AFTER 03_migrate_v4_ops.sql.
-- ============================================================================

-- ---------- SERVICE CATALOGUE ----------------------------------------------
insert into public.service_catalogue (name, hsn_sac, unit, default_rate, gst_rate, description)
select v.name, v.hsn_sac, v.unit, v.rate, v.gst, v.descr
from (values
  ('Aerial Spraying - Agriculture Services (Short Crop)', '9986', 'Acre', 400, 0, 'Standard rate for short-crop aerial spraying'),
  ('Aerial Spraying - Agriculture Services (Tall Crop)',  '9986', 'Acre', 500, 0, 'Standard rate for tall-crop aerial spraying'),
  ('Aerial Spraying - Agriculture Services (Custom)',     '9986', 'Acre', null, 0, 'Aerial spraying at a location-specific negotiated rate'),
  ('Drone Demonstration / Training',                      '9986', 'Day',  null, 18, 'On-site demonstration or pilot training')
) as v(name, hsn_sac, unit, rate, gst, descr)
where not exists (select 1 from public.service_catalogue s where s.name = v.name);

-- ---------- SPARE CATALOGUE -------------------------------------------------
insert into public.spare_catalogue (name, hsn_code, unit, rate_excl_gst, gst_rate, description, current_stock)
select v.name, v.hsn, v.unit, v.rate, v.gst, v.descr, v.stock
from (values
  ('Propeller 2480 CW',                '88071000', 'Set',   null, 5, null, 2),
  ('Propeller 2480 CCW',               '88071000', 'Set',   null, 5, null, 2),
  ('Propeller 2388 CW',                '88071000', 'Set',   null, 5, null, 1),
  ('Propeller 2388 CCW',               '88071000', 'Set',   null, 5, null, 0),
  ('Propeller 3011 CW',                '88071000', 'Set',   null, 5, null, 1),
  ('Propeller 3011 CCW',               '88071000', 'Set',   null, 5, null, 0),
  ('Hub 3011',                         null,        'Unit',  null, 5, null, 2),
  ('Horizontal Landing Gear 610',      '88073020', 'Set',   null, 5, null, 1),
  ('Vertical Landing Gear',            '88073020', 'Set',   null, 5, null, 0),
  ('Landing Gear Bar 610',             '88073020', 'Unit',  null, 5, null, 2),
  ('Landing Gear Brace 610',           '88073020', 'Unit',  null, 5, null, 4),
  ('Landing Gear Bar 616',             '88073020', 'Unit',  null, 5, null, 3),
  ('Landing Gear Brace 616',           '88073020', 'Unit',  null, 5, null, 8),
  ('Arm Joint',                        '88073020', 'Unit',  null, 5, null, 1),
  ('Landing Gear Mount',               '88073020', 'Unit',  null, 5, null, 16),
  ('Landing Gear T-Connector',         '88073020', 'Unit',  null, 5, null, 12),
  ('Tank Mount',                       '88073020', 'Unit',  null, 5, null, 14),
  ('Rubber Sponge (Landing Gear)',     '88073020', 'Unit',  null, 5, null, 12),
  ('Nozzle Mount',                     null,        'Set',   null, 5, null, 1),
  ('Pushin Fitting - L Connector',     null,        'Unit',  null, 18, '12-10mm', 50),
  ('Pushin Fitting - T Connector (8-8-12)', null,   'Unit',  null, 18, '8-8-12mm', 50),
  ('Pushin Fitting - T Connector (8-8-10)', null,   'Unit',  null, 18, '8-8-10mm', 53),
  ('Pushin Fitting - T Connector (8-8-8)',  null,   'Unit',  null, 18, '8-8-8mm', 51),
  ('Pushin Fitting - S Connector',     null,        'Unit',  null, 18, '8-6mm', 50),
  ('Polyurethane (PU) Pipe (12-8mm)',  null,        'Meter', null, 18, '12-8mm', 104),
  ('Polyurethane (PU) Pipe (10-6mm)',  null,        'Meter', null, 18, '10-6mm', 103),
  ('Polyurethane (PU) Pipe (8-5mm)',   null,        'Meter', null, 18, '8-5mm', 105),
  ('Battery Plug Holder',              '88073000', 'Unit',  null, 5, null, 2),
  ('Power Cable XT-90',                null,        'Unit',  null, 18, null, 1),
  ('XT-90 Connector with Cap',         null,        'Piece', null, 18, null, 50),
  ('XT-60 Connector',                  null,        'Piece', null, 18, null, 50),
  -- New spare from the VAAYU 24000 advertisement (₹30,083.89 excl GST, 18% GST)
  ('Battery VAAYU 24000',              '85076000', 'Unit',  30083.89, 18, 'VAAYU 24000mAh 21.6V agriculture drone battery, BIS IS 16046 (Part 2), 400 cycles', 0)
) as v(name, hsn, unit, rate, gst, descr, stock)
where not exists (select 1 from public.spare_catalogue s where s.name = v.name);

-- ---------- DEFAULT BOM DESIGN (from the Drone Quotations Builder) ----------
insert into public.bom_designs (name, description, parts, overhead_pct, profit_pct, commission_pct)
select 'Standard Agri Drone (No Sensor) — 1 Set Battery',
       'Default BOM seeded from the Drone Quotations Builder. Rates are standard; edit per design.',
       '[
         {"part":"Frame","qty":1,"rate_excl":33999,"gst_rate":5},
         {"part":"Flight Controller","qty":1,"rate_excl":30499,"gst_rate":5},
         {"part":"Remote controller","qty":1,"rate_excl":17500,"gst_rate":5},
         {"part":"Motor","qty":6,"rate_excl":8950,"gst_rate":5},
         {"part":"Battery","qty":0,"rate_excl":27874,"gst_rate":18},
         {"part":"Propellor","qty":6,"rate_excl":600,"gst_rate":5},
         {"part":"Propellor Hub","qty":6,"rate_excl":402,"gst_rate":5},
         {"part":"Centrifugal Nozzle","qty":0,"rate_excl":5999,"gst_rate":5},
         {"part":"Nozzle","qty":4,"rate_excl":989,"gst_rate":5},
         {"part":"Spraying Kit","qty":1,"rate_excl":891.45,"gst_rate":5},
         {"part":"Terrain Radar","qty":0,"rate_excl":14999,"gst_rate":5},
         {"part":"Optical Radar","qty":0,"rate_excl":15299,"gst_rate":5},
         {"part":"CAN hub","qty":0,"rate_excl":6500,"gst_rate":5},
         {"part":"Pump","qty":1,"rate_excl":5000,"gst_rate":5},
         {"part":"Charger","qty":0,"rate_excl":17500,"gst_rate":18}
       ]'::jsonb,
       15, 10, 2
where not exists (select 1 from public.bom_designs b where b.name = 'Standard Agri Drone (No Sensor) — 1 Set Battery');


-- ####################################################################
-- ## 05_grant_privileges.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — API role privileges
-- Some Supabase projects do NOT auto-grant table privileges to the API roles
-- (anon / authenticated). Without these GRANTs, PostgREST returns
-- "42501 permission denied for table ..." even though RLS policies exist.
-- These grants give the roles table access; ROW-LEVEL SECURITY still governs
-- exactly which rows each user can see/change.
-- Safe to run multiple times. Run this once on an existing project; it is also
-- included at the end of ALL_IN_ONE.sql for fresh setups.
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- existing objects
grant select, insert, update, delete on all tables    in schema public to authenticated;
grant usage,  select                  on all sequences in schema public to authenticated;
grant execute                         on all functions in schema public to anon, authenticated;

-- future objects (so later migrations inherit the grants automatically)
alter default privileges in schema public grant select, insert, update, delete on tables    to authenticated;
alter default privileges in schema public grant usage,  select                  on sequences to authenticated;
alter default privileges in schema public grant execute                         on functions to anon, authenticated;

-- ============================================================================
-- After running this: in the app, click the role pill (top-right) to refresh,
-- or sign out and back in. The first user you created is the admin.
-- ============================================================================

-- ####################################################################
-- ## 06_restrict_signup_domains.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — restrict self sign-up to approved company domains.
-- Replaces handle_new_user so any sign-up from a non-approved email domain is
-- rejected (the auth user creation rolls back). Edit the domain list below to
-- add/remove allowed domains. Keep the first-user-becomes-admin behaviour.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
  email_domain text := lower(split_part(new.email,'@',2));
  allowed text[] := array['droconbharat.com','ibsideas.com'];   -- <- edit here
begin
  if not (email_domain = any(allowed)) then
    raise exception 'Sign-ups are restricted to %  email addresses.', array_to_string(allowed, ' or @');
  end if;

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
-- (Trigger on_auth_user_created from the base schema already calls this function.)

-- ####################################################################
-- ## 07_hr.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — HR / Payroll (Phase 4)
-- Employees & consultants, monthly salary runs (attendance/LOP-adjusted net pay),
-- salary payments, and a light accounting ledger. Run AFTER 05_grant_privileges
-- (so default privileges are already set for these new tables).
-- ============================================================================

-- employees & consultants master
create table if not exists public.employees (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  designation    text,
  emp_type       text not null default 'employee' check (emp_type in ('employee','consultant')),
  monthly_salary numeric not null default 0,
  doj            date,                    -- date of joining
  dol            date,                    -- date of leaving (null = active)
  phone          text,
  email          text,
  status         text not null default 'active' check (status in ('active','inactive')),
  bank_details   text,
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- one salary run per employee per month
create table if not exists public.salary_runs (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid references public.employees(id) on delete cascade,
  period_month   text not null,           -- 'YYYY-MM'
  period_start   date,
  period_end     date,
  monthly_salary numeric,                  -- snapshot at calculation time
  working_days   numeric,                  -- engaged calendar days in the period
  off_days       numeric,                  -- sundays + holidays (informational)
  lop_days       numeric default 0,        -- loss-of-pay / unauthorised absence
  month_days     numeric,                  -- days in the month
  month_worked   numeric,                  -- effective fraction worked
  net_payable    numeric,
  status         text not null default 'calculated' check (status in ('calculated','posted','paid')),
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists salary_runs_uniq on public.salary_runs(employee_id, period_month);
create index if not exists salary_runs_month_idx on public.salary_runs(period_month);

-- payments against salary runs
create table if not exists public.salary_payments (
  id            bigint generated always as identity primary key,
  salary_run_id uuid references public.salary_runs(id) on delete cascade,
  amount        numeric not null,
  paid_on       date not null default current_date,
  mode          text,
  note          text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

-- light accounting ledger (salary expense / payable / bank postings)
create table if not exists public.accounting_entries (
  id           bigint generated always as identity primary key,
  voucher_date date not null default current_date,
  narration    text,
  account      text not null,             -- e.g. 'Salaries & Wages', 'Salaries Payable', 'Bank'
  debit        numeric default 0,
  credit       numeric default 0,
  ref_type     text,                      -- 'salary_run' | 'salary_payment' | ...
  ref_id       text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists acct_date_idx on public.accounting_entries(voucher_date desc);

-- updated_at triggers
do $$ declare t text;
begin
  foreach t in array array['employees','salary_runs'] loop
    execute format('drop trigger if exists %I_touch on public.%I;', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at_ops();', t, t);
  end loop;
end $$;

-- RLS: team read, authenticated write, creator/admin delete
do $$ declare t text;
begin
  foreach t in array array['employees','salary_runs','salary_payments','accounting_entries'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true);', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (true);', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (true);', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.has_role(array[''admin'',''approver'']::user_role[]) or created_by = auth.uid());', t, t);
  end loop;
end $$;

-- explicit grants (belt-and-suspenders; default privileges from 05 should already cover)
grant select, insert, update, delete on public.employees, public.salary_runs, public.salary_payments, public.accounting_entries to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ####################################################################
-- ## 08_seed_full_catalogues.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — full catalogue seed from the 2026 PDFs
--   Services: DCB Maintenance Rate Card 2026
--   Spares  : Drocon Bharat Spare Parts Catalogue 2026
-- HSN/SAC left blank for the team to assign. GST set to a sensible default
-- (services 18%, batteries/electrical 18%, mechanical 5%) — editable in-app.
-- Guarded by NOT EXISTS on name, so safe to re-run. Run AFTER 04_seed_catalogues.
-- ============================================================================

-- ---------------- SERVICES ----------------
insert into public.service_catalogue (name, hsn_sac, unit, default_rate, gst_rate, description)
select v.name, null, v.unit, v.rate, 18, v.descr
from (values
  ('Bench Inspection & Diagnostic','per drone',599,'Adjusted to repair if approved'),
  ('Comprehensive 40-Point Health Check','per drone',999,'Full structured health check'),
  ('Motor Inspection','per motor',99,null),
  ('Crash / Water-Damage Assessment','per drone',1499,'Adjusted to repair if approved'),
  ('Firmware / GCS Software Update','one-time',499,null),
  ('RC / Remote Controller Calibration','per session',399,null),
  ('Remote-Pilot Calibration Suite','per drone',699,null),
  ('Online / Remote Support','per incident',199,'Up to 30 min'),
  ('Spare Install — Tier 1 (Simple fitment)','per item/set',149,null),
  ('Spare Install — Tier 2 (Moderate fitment)','per item',399,null),
  ('Spare Install — Tier 3 (Complex/avionics fitment)','per item',799,null),
  ('Motor replacement + balance test','per motor',449,null),
  ('ESC replacement + calibration','per unit',649,null),
  ('Flight-controller replace + setup','per unit',1199,null),
  ('Tx/Rx binding & wiring','per job',449,null),
  ('Battery diagnostics & balancing','per drone',299,null),
  ('GPS module replace + calibration','per unit',649,null),
  ('Frame arm / boom replacement','per arm',599,null),
  ('Landing-gear replacement (labour)','per set',349,null),
  ('Water-pump replacement (labour)','per unit',349,null),
  ('Spray-line / wiring rework','per job',249,'From'),
  ('Half-Day Field Visit (<=25km, <=3h)','per half-day',1799,'Travel/stay extra'),
  ('Full-Day Field Visit (day fee)','per day',2999,'Travel/stay extra'),
  ('DCB Care - Essential (AMC)','per year',18999,'Annual maintenance plan'),
  ('DCB Care - Pro (AMC)','per year',37999,'Annual maintenance plan'),
  ('DCB Care - Elite (AMC)','per year',74999,'Annual maintenance plan')
) as v(name, unit, rate, descr)
where not exists (select 1 from public.service_catalogue s where s.name = v.name);

-- ---------------- SPARES ----------------
insert into public.spare_catalogue (name, hsn_code, unit, rate_excl_gst, gst_rate, description, current_stock)
select v.name, null, v.unit, v.rate, v.gst, v.descr, 0
from (values
  -- Propellers
  ('2388 Propeller','per set',999,5,'Propeller set'),
  ('2480 Propeller','per set',1049,5,'Propeller set'),
  ('3011 Propeller','per set',1249,5,'Propeller set'),
  -- Spraying System
  ('Spraying Kit / Pneumatic Connector with Pipe','per kit',849,5,null),
  ('Flat Nozzles','per piece',989,5,null),
  ('5 Ltr Water Pump','per piece',6299,5,null),
  ('8 Ltr Water Pump','per piece',7299,5,null),
  ('Pneumatic Connector 8-8-8 T','per piece',63,18,null),
  ('Pneumatic Connector 8-8-10 T','per piece',113,18,null),
  ('Pneumatic Connector 8-8-12 T','per piece',129,18,null),
  ('Pneumatic Connector 10-12 L','per piece',79,18,null),
  ('Pneumatic Connector 8-6','per piece',44,18,null),
  ('Pneumatic Pipe 6mm OD','per meter',45,18,null),
  ('Pneumatic Pipe 8mm OD','per meter',45,18,null),
  ('Pneumatic Pipe 10mm OD','per meter',55,18,null),
  ('Pneumatic Pipe 12mm OD','per meter',80,18,null),
  -- Landing Gear
  ('Horizontal Landing Gear (E610)','per set',3699,5,null),
  ('Horizontal Landing Gear (E616)','per set',3849,5,null),
  ('Vertical Landing Gear (E610)','per set',1949,5,null),
  ('Vertical Landing Gear (E616)','per set',2149,5,null),
  ('Fix Seat Connector','per piece',499,5,null),
  -- Power, Wiring & Connectors
  ('25200 mAh Battery Set','per set',41624,18,null),
  ('22500 mAh Battery Set','per set',37874,18,null),
  ('XT90 Power Connector','per piece',1199,18,null),
  ('Red Silicon Wire 8 AWG','per meter',359,18,null),
  ('Red Silicon Wire 12 AWG','per meter',149,18,null),
  ('Red Silicon Wire 14 AWG','per meter',99,18,null),
  ('Red Silicon Wire 16 AWG','per meter',79,18,null),
  ('Red Silicon Wire 18 AWG','per meter',59,18,null),
  ('Red Silicon Wire 22 AWG','per meter',39,18,null),
  ('Black Silicon Wire 8 AWG','per meter',359,18,null),
  ('Black Silicon Wire 12 AWG','per meter',149,18,null),
  ('Black Silicon Wire 14 AWG','per meter',99,18,null),
  ('Black Silicon Wire 16 AWG','per meter',79,18,null),
  ('Black Silicon Wire 18 AWG','per meter',59,18,null),
  ('Black Silicon Wire 22 AWG','per meter',39,18,null),
  ('XT90 Connector with Cap','per pair',129,18,null),
  ('XT60 Connector','per pair',49,18,null),
  ('T-Connector','per pair',39,18,null),
  ('Splice Connector (3-Pin, Wired)','per pair',59,18,null),
  -- Hardware
  ('Drone Screw (small)','per screw',5,5,null),
  ('Drone Screw (large)','per screw',20,5,null),
  -- Logistics
  ('Drone Sarthi Customised Carry Box','per piece',24599,18,'Box only, without bike; SS ventilated, 10L drone + 5 battery sets + charger')
) as v(name, unit, rate, gst, descr)
where not exists (select 1 from public.spare_catalogue s where s.name = v.name);

-- ####################################################################
-- ## 09_approvals.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — approval workflow (Phase 4)
-- Adds a Draft -> Submitted -> Approved/Rejected approval track to clients,
-- vendors, documents (invoice/CN/quotation/PO) and bom_designs. Kept SEPARATE
-- from any existing lifecycle/payment status. Each submission is assigned to a
-- reviewer; the consolidated Review/Approvals tab shows each user only what is
-- assigned to them. (Agreements keep their own status workflow.)
-- Safe to re-run.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['clients','vendors','documents','bom_designs'] loop
    execute format('alter table public.%I add column if not exists approval_status text not null default ''draft'';', t);
    execute format('alter table public.%I add column if not exists submitted_by uuid references public.profiles(id);', t);
    execute format('alter table public.%I add column if not exists submitted_at timestamptz;', t);
    execute format('alter table public.%I add column if not exists assigned_approver uuid references public.profiles(id);', t);
    execute format('alter table public.%I add column if not exists approved_by uuid references public.profiles(id);', t);
    execute format('alter table public.%I add column if not exists approved_at timestamptz;', t);
    execute format('alter table public.%I add column if not exists reject_note text;', t);
    execute format('create index if not exists %I_approval_idx on public.%I(approval_status, assigned_approver);', t, t);
  end loop;
end $$;

-- ####################################################################
-- ## 10_security_hardening.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — data-security hardening (PII)
-- Enforces, IN THE DATABASE (not just the UI), that sensitive personal data is
-- only readable/writable by people the admin has actually granted access to.
-- Without this, any signed-in user could read e.g. salaries or bank details
-- directly through the API. Run AFTER 03/07/09. Safe to re-run.
--
-- Model: access to a sensitive table = admin OR holding the matching per-tool
-- permission (app_permissions). This makes the per-tool grants a real security
-- boundary, consistent with the in-app "Team & Access" screen.
-- ============================================================================

-- HR / payroll access: admin or anyone granted any HR tool
create or replace function public.has_hr_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists (select 1 from public.app_permissions p
                 where p.user_id = auth.uid()
                   and p.tool_key in ('hr_salary','hr_employees','hr_records'));
$$;

-- Farmer-data access (names + phone numbers): admin or the Farmer Tracker grant
create or replace function public.has_farmer_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists (select 1 from public.app_permissions p
                 where p.user_id = auth.uid() and p.tool_key = 'farmer');
$$;

-- ---- Lock down HR tables (salaries, bank details, payroll, ledger) ----------
do $$
declare t text;
begin
  foreach t in array array['employees','salary_runs','salary_payments','accounting_entries'] loop
    -- drop the permissive team-wide policies created earlier
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    -- recreate, gated to HR access
    execute format('create policy %I_read   on public.%I for select to authenticated using (public.has_hr_access());', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.has_hr_access());', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.has_hr_access());', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.has_role(array[''admin'']::user_role[]));', t, t);
  end loop;
end $$;

-- ---- Lock down farmer data (phone numbers, names, villages) ------------------
drop policy if exists farmer_sprays_read   on public.farmer_sprays;
drop policy if exists farmer_sprays_insert on public.farmer_sprays;
drop policy if exists farmer_sprays_update on public.farmer_sprays;
drop policy if exists farmer_sprays_delete on public.farmer_sprays;
create policy farmer_sprays_read   on public.farmer_sprays for select to authenticated using (public.has_farmer_access());
create policy farmer_sprays_insert on public.farmer_sprays for insert to authenticated with check (public.has_farmer_access());
create policy farmer_sprays_update on public.farmer_sprays for update to authenticated using (public.has_farmer_access());
create policy farmer_sprays_delete on public.farmer_sprays for delete to authenticated
  using (public.has_role(array['admin']::user_role[]) or created_by = auth.uid());

-- ============================================================================
-- Notes:
--  • Admin always has access (bootstrap + oversight).
--  • Other tables (clients, vendors, documents, orders, partners, acre) remain
--    team-readable by design (small-team operations). To restrict any of them
--    the same way, copy the pattern above with the relevant tool_key.
--  • Column-level secrets (e.g. employees.bank_details) are protected by the
--    row-level gate above and encrypted at rest by Supabase.
-- ============================================================================

-- ####################################################################
-- ## 11_access_log.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — access log (who viewed which sensitive record)
-- Each user can write their own view events; only admins can read the log.
-- Run after the earlier migrations. Safe to re-run.
-- ============================================================================
create table if not exists public.access_log (
  id          bigint generated always as identity primary key,
  viewer      uuid references public.profiles(id),
  table_name  text not null,
  record_id   text,
  label       text,
  created_at  timestamptz not null default now()
);
create index if not exists access_log_idx on public.access_log(created_at desc);

alter table public.access_log enable row level security;

drop policy if exists access_insert on public.access_log;
create policy access_insert on public.access_log
  for insert to authenticated with check (viewer = auth.uid());

drop policy if exists access_read on public.access_log;
create policy access_read on public.access_log
  for select to authenticated using (public.has_role(array['admin']::user_role[]));

grant select, insert on public.access_log to authenticated;

-- ('view_contacts' is a per-tool grant stored in app_permissions — no schema
--  change needed; it is managed from the in-app Team & Access screen.)

-- ####################################################################
-- ## 12_invoice_entity.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — billing entity on documents (DCB vs IBS)
-- DroCon Bharat (DCB) and Innovative Business Solution (IBS) both raise
-- invoices. This tags each document with its issuing entity so receivables and
-- dashboards can be viewed per entity. Generated documents default to 'DCB'.
-- Safe to re-run.
-- ============================================================================
alter table public.documents add column if not exists entity text not null default 'DCB';
create index if not exists documents_entity_idx on public.documents(entity);

-- ####################################################################
-- ## 13_documents_entity_unique.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — make document numbers unique PER ENTITY
-- DCB and IBS reuse the same invoice-number series, so uniqueness must include
-- the entity. Replaces the (doc_type, number) unique index with
-- (doc_type, entity, number). Safe to re-run.
-- ============================================================================
drop index if exists public.documents_number_uniq;
create unique index if not exists documents_entity_number_uniq
  on public.documents(doc_type, entity, number);

-- ####################################################################
-- ## 14_clients_fields.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — client master fields (align to the Client Setup structure)
-- Adds the client reference number and district. Safe to re-run.
-- ============================================================================
alter table public.clients add column if not exists client_ref text;
alter table public.clients add column if not exists district  text;
alter table public.clients alter column name drop not null;

-- ####################################################################
-- ## 15_delete_export_access.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — delete access control
-- Admins can delete anything; admins can also GRANT delete rights to others via
-- the 'can_delete' per-tool permission. Deletions are recorded in audit_log by
-- the app. (Export control is enforced in the UI — see app.js capabilities.)
-- Safe to re-run.
-- ============================================================================
create or replace function public.has_delete_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists (select 1 from public.app_permissions p
                 where p.user_id = auth.uid() and p.tool_key = 'can_delete');
$$;

-- main business tables: deletable by a delete-access holder or the row's creator
do $$ declare t text;
begin
  foreach t in array array['clients','vendors','authorized_partners','documents',
                           'bom_designs','potential_orders','acre_entries','spray_locations',
                           'service_catalogue','spare_catalogue'] loop
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated
                    using (public.has_delete_access());', t, t);
  end loop;
end $$;
-- (HR + farmer deletes remain restricted to admin/creator with their own access gates.)

-- ####################################################################
-- ## 16_farmer_district.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — add district to farmer sprays (state already exists).
-- Old rows leave it blank; new entries capture it. Safe to re-run.
-- ============================================================================
alter table public.farmer_sprays add column if not exists district text;

alter table public.potential_orders add column if not exists district text;

-- ####################################################################
-- ## 17_common_entry_link.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — link Farmer & Acre rows entered via the common Daily Entry form
-- A shared source_id lets the two trackers stay separate (for client
-- reconciliation) while being entered once. Safe to re-run.
-- ============================================================================
alter table public.farmer_sprays add column if not exists source_id uuid;
alter table public.acre_entries  add column if not exists source_id uuid;
create index if not exists farmer_source_idx on public.farmer_sprays(source_id);
create index if not exists acre_source_idx   on public.acre_entries(source_id);

-- ####################################################################
-- ## 18_acre_split_rates.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — split acre rate into client-paid + farmer-paid portions.
-- A spray may be billed partly to the client and partly to the farmer; the
-- effective rate = client_rate + farmer_rate. Safe to re-run.
-- ============================================================================
alter table public.acre_entries add column if not exists client_rate numeric;
alter table public.acre_entries add column if not exists farmer_rate numeric;
