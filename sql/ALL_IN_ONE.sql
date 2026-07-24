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
  chemical    text,
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

-- ####################################################################
-- ## 19_bom_fields.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — BOM design context (client + delivery location + type)
-- Captures the potential client and delivery State/District (for logistics
-- estimation) and whether it's an agriculture design. Labour & logistics are
-- captured as line items in the parts list. Safe to re-run.
-- ============================================================================
alter table public.bom_designs add column if not exists client_name       text;
alter table public.bom_designs add column if not exists delivery_state     text;
alter table public.bom_designs add column if not exists delivery_district  text;
alter table public.bom_designs add column if not exists design_type        text default 'agriculture';

-- ####################################################################
-- ## 20_partner_fields.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — Authorized Partner expansion
-- Number of drones the partner provides + their MSA responsibilities. Safe to re-run.
-- ============================================================================
alter table public.authorized_partners add column if not exists drones_provided numeric;
alter table public.authorized_partners add column if not exists responsibilities text;

-- ####################################################################
-- ## 21_resources_consultants.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — Resources (policies) + consultant agreement link (#1, #5)
-- Files are referenced by external-drive LINK (per chosen approach). Safe to re-run.
-- ============================================================================
create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  category    text,
  description text,
  link        text,                 -- external drive / SharePoint URL
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.resources enable row level security;
drop policy if exists resources_read on public.resources;
create policy resources_read on public.resources for select to authenticated using (true);
drop policy if exists resources_insert on public.resources;
create policy resources_insert on public.resources for insert to authenticated with check (true);
drop policy if exists resources_update on public.resources;
create policy resources_update on public.resources for update to authenticated using (true);
drop policy if exists resources_delete on public.resources;
create policy resources_delete on public.resources for delete to authenticated using (public.has_delete_access());
grant select, insert, update, delete on public.resources to authenticated;

-- signed-agreement link for employees/consultants
alter table public.employees add column if not exists agreement_link text;

-- ####################################################################
-- ## 22_payslips.sql
-- ####################################################################

-- ============================================================================
-- DroCon Cloud — Payslips (#11)
-- Per-employee configurable deductions (text lines like "PPF=12%" or
-- "Advance=2000"). Payslips are generated from the monthly salary run by an
-- admin, approved by an admin, and exported as a letterheaded Word document.
-- Consultants are excluded (employees only). Safe to re-run.
-- ============================================================================
alter table public.employees add column if not exists deductions_text text;

create table if not exists public.payslips (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references public.employees(id) on delete cascade,
  period_month  text not null,                 -- 'YYYY-MM'
  base          numeric,                        -- earned (attendance-adjusted) pay
  deductions    jsonb default '[]',             -- [{name, amount}]
  net           numeric,
  status        text not null default 'draft',  -- draft | approved
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists payslips_uniq on public.payslips(employee_id, period_month);

alter table public.payslips enable row level security;
-- read: HR-access holders; write/approve: admins only
drop policy if exists payslips_read on public.payslips;
create policy payslips_read on public.payslips for select to authenticated using (public.has_hr_access());
drop policy if exists payslips_write on public.payslips;
create policy payslips_write on public.payslips for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));
grant select, insert, update, delete on public.payslips to authenticated;


-- ############################################################################
-- ## 23_partner_portal.sql  (Partners portal — external invite logins, #3/#4)
-- ############################################################################
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


-- ############################################################################
-- ## 24_daily_approval.sql  (Daily two-level approval + edit gating, #12/#13)
-- ############################################################################
-- ============================================================================
-- DroCon Cloud — Daily Spray Entry two-level approval (#12) + edit gating (#13)
-- A day's sprays are first SUBMITTED as a daily_submissions batch (rows held as
-- JSON). A reviewer/admin APPROVES, which POSTS the batch — expanding it into
-- farmer_sprays + acre_entries via a SECURITY DEFINER function so nothing reaches
-- the dashboards until approved. Approved/posted batches can only be REOPENED by
-- an admin (which deletes the posted rows) — that is the daily "edit needs
-- approval" control. Safe to re-run.
-- ============================================================================

create table if not exists public.daily_submissions (
  id                uuid primary key default gen_random_uuid(),
  entry_date        date not null,
  client_id         uuid,
  client_name       text,
  location_name     text not null,
  state             text,
  district          text,
  rows              jsonb not null default '[]',   -- [{pilot,farmer,phone,village,crop,chemical,acres,crate,frate,gps}]
  total_acres       numeric,
  total_amount      numeric,
  spray_count       integer,
  approval_status   text not null default 'submitted',  -- draft | submitted | approved | rejected
  submitted_by      uuid references public.profiles(id),
  assigned_approver uuid references public.profiles(id),
  submitted_at      timestamptz default now(),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  reject_note       text,
  posted            boolean not null default false,
  posted_source_ids text[],                          -- source_id of every posted child row (for reopen)
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists daily_sub_status   on public.daily_submissions(approval_status);
create index if not exists daily_sub_approver  on public.daily_submissions(assigned_approver);
create index if not exists daily_sub_submitter on public.daily_submissions(submitted_by);

alter table public.daily_submissions enable row level security;
-- read: internal users who are the submitter, the assigned reviewer, an approver/admin,
--       or hold farmer access (the rows carry farmer PII).
drop policy if exists daily_sub_read on public.daily_submissions;
create policy daily_sub_read on public.daily_submissions for select to authenticated
  using (public.is_internal() and (
            submitted_by = auth.uid()
         or assigned_approver = auth.uid()
         or public.has_role(array['admin','approver']::user_role[])
         or public.has_farmer_access()));
-- insert: any internal user files their own submission
drop policy if exists daily_sub_insert on public.daily_submissions;
create policy daily_sub_insert on public.daily_submissions for insert to authenticated
  with check (public.is_internal() and submitted_by = auth.uid());
-- update: submitter may edit only while NOT yet approved/posted; approver/admin always
drop policy if exists daily_sub_update on public.daily_submissions;
create policy daily_sub_update on public.daily_submissions for update to authenticated
  using (public.is_internal() and (
            (submitted_by = auth.uid() and posted = false and approval_status <> 'approved')
         or assigned_approver = auth.uid()
         or public.has_role(array['admin','approver']::user_role[])));
-- delete: submitter while still a draft/rejected (un-posted), or an admin
drop policy if exists daily_sub_delete on public.daily_submissions;
create policy daily_sub_delete on public.daily_submissions for delete to authenticated
  using ((submitted_by = auth.uid() and posted = false and approval_status in ('draft','rejected'))
         or public.has_role(array['admin']::user_role[]));
grant select, insert, update, delete on public.daily_submissions to authenticated;

-- ---------------------------------------------------------------------------
-- post_daily_submission — approve + expand the batch into the live trackers.
-- SECURITY DEFINER: bypasses farmer/acre RLS so the approver need not personally
-- hold farmer access; authorisation is checked explicitly below.
-- ---------------------------------------------------------------------------
create or replace function public.post_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     public.daily_submissions%rowtype;
  r     jsonb;
  loc   uuid;
  sid   uuid;
  acres numeric; cr numeric; fr numeric; amt numeric;
  sids  text[] := array[]::text[];
begin
  select * into s from public.daily_submissions where id = p_id;
  if s.id is null then raise exception 'Submission not found'; end if;
  if s.posted then raise exception 'This submission is already posted'; end if;

  -- authorisation: admin/approver, or the assigned reviewer
  if not (public.has_role(array['admin','approver']::user_role[])
          or s.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to approve this daily submission';
  end if;

  -- resolve (or create) the spray location by name
  select id into loc from public.spray_locations where lower(name) = lower(s.location_name) limit 1;
  if loc is null then
    insert into public.spray_locations(name, state, district, rates)
      values (s.location_name, s.state, s.district, '{}'::jsonb) returning id into loc;
  end if;

  for r in select * from jsonb_array_elements(s.rows) loop
    acres := coalesce(nullif(r->>'acres','')::numeric, 0);
    cr    := coalesce(nullif(r->>'crate','')::numeric, 0);
    fr    := coalesce(nullif(r->>'frate','')::numeric, 0);
    -- skip empty rows (no acres and no farmer)
    if acres = 0 and coalesce(trim(r->>'farmer'),'') = '' then continue; end if;
    amt := acres * (cr + fr);
    sid := gen_random_uuid();
    sids := array_append(sids, sid::text);

    insert into public.acre_entries
      (entry_date, location_id, pilot_name, acres, rate, client_rate, farmer_rate, amount, crop, chemical, source_id, created_by)
    values
      (s.entry_date, loc, nullif(r->>'pilot',''), acres, nullif(cr+fr,0), nullif(cr,0), nullif(fr,0),
       nullif(amt,0), nullif(r->>'crop',''), nullif(r->>'chemical',''), sid, s.submitted_by);

    insert into public.farmer_sprays
      (spray_date, pilot_name, client_name, farmer_name, contact_no, village, state, district,
       chemical_company, crop, acre, rate, amount, gps_image_present, source_id, created_by)
    values
      (s.entry_date, nullif(r->>'pilot',''), s.client_name, nullif(r->>'farmer',''), nullif(r->>'phone',''),
       nullif(r->>'village',''), s.state, s.district, nullif(r->>'chemical',''), nullif(r->>'crop',''),
       nullif(acres,0), nullif(cr+fr,0), nullif(amt,0), coalesce((r->>'gps')::boolean,false), sid, s.submitted_by);
  end loop;

  update public.daily_submissions
     set approval_status='approved', approved_by=auth.uid(), approved_at=now(),
         posted=true, posted_source_ids=sids, updated_at=now()
   where id = p_id;
end $$;
grant execute on function public.post_daily_submission(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reopen_daily_submission — admin-only correction: delete the posted child rows
-- and send the batch back to 'submitted' so it can be edited and re-approved.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.daily_submissions%rowtype;
begin
  select * into s from public.daily_submissions where id = p_id;
  if s.id is null then raise exception 'Submission not found'; end if;
  if not public.has_role(array['admin']::user_role[]) then
    raise exception 'Only an admin can reopen a posted daily submission';
  end if;
  if s.posted_source_ids is not null and array_length(s.posted_source_ids,1) > 0 then
    delete from public.acre_entries  where source_id = any(s.posted_source_ids);
    delete from public.farmer_sprays where source_id = any(s.posted_source_ids);
  end if;
  update public.daily_submissions
     set approval_status='submitted', posted=false, posted_source_ids=null,
         approved_by=null, approved_at=null, updated_at=now()
   where id = p_id;
end $$;
grant execute on function public.reopen_daily_submission(uuid) to authenticated;

-- ============================================================================
-- Done. Daily Spray Entry now submits for approval; approving posts to the
-- Farmer & Acre trackers; only an admin can reopen a posted day.
-- ============================================================================


-- ############################################################################
-- ## 25_partner_rate_cards.sql  (per-partner Authorized Partner rate cards)
-- ############################################################################
-- ============================================================================
-- DroCon Cloud — Per-partner Authorized-Partner rate cards
-- The commission slabs become a per-partner rate card: each authorized partner
-- can carry their own slabs. Rows with partner_id IS NULL remain the STANDARD
-- (default) card used as a fallback when a partner has no custom card.
-- A partner (external login) may read only their OWN card + the standard one.
-- Safe to re-run.
-- ============================================================================

alter table public.partner_rates
  add column if not exists partner_id uuid references public.authorized_partners(id) on delete cascade;
create index if not exists partner_rates_partner on public.partner_rates(partner_id);

-- Tighten read: internal users see all; an external partner sees only the
-- standard card (partner_id null) plus their own (partner_id = their party_id).
drop policy if exists partner_rates_read on public.partner_rates;
create policy partner_rates_read on public.partner_rates for select to authenticated
  using (
    public.is_internal()
    or partner_id is null
    or partner_id = (select p.party_id from public.profiles p where p.id = auth.uid())
  );
-- write stays admin-only (unchanged)
drop policy if exists partner_rates_write on public.partner_rates;
create policy partner_rates_write on public.partner_rates for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));

-- ============================================================================
-- Done. Manage cards in Partners → Authorized Partner: pick a partner (or the
-- Standard card), edit their slabs, save. Invoices resolve commission from the
-- partner's own card, falling back to the Standard card.
-- ============================================================================


-- ############################################################################
-- ## 26_partner_agreement_link.sql  (Authorized Partner -> signed agreement link)
-- ############################################################################
-- ============================================================================
-- DroCon Cloud — link each Authorized Partner to their signed agreement
-- Lets the Authorized Partners home (Business Development) reference the partner's
-- agreement (a drive URL), connecting the pool to the Agreements tab. Safe to re-run.
-- ============================================================================
alter table public.authorized_partners add column if not exists agreement_link text;

-- ============================================================================
-- DroCon Cloud — Inventory entries: edit-requires-approval (change-on-approve)
-- Creating a stock entry is free. EDITING an existing entry does NOT take effect
-- until a designated approver/admin approves it: the proposed values are parked
-- in pending_changes and only written to the live row (and stock) on approval.
-- Enforced by RLS (non-admins cannot UPDATE directly) + SECURITY DEFINER RPCs.
-- Safe to re-run.
-- ============================================================================

alter table public.inventory_moves add column if not exists purchase_invoice_no text;
alter table public.inventory_moves add column if not exists sales_invoice_no    text;
alter table public.inventory_moves add column if not exists approval_status     text not null default 'approved'; -- approved | submitted
alter table public.inventory_moves add column if not exists assigned_approver   uuid references public.profiles(id);
alter table public.inventory_moves add column if not exists submitted_by        uuid references public.profiles(id);
alter table public.inventory_moves add column if not exists submitted_at        timestamptz;
alter table public.inventory_moves add column if not exists approved_by         uuid references public.profiles(id);
alter table public.inventory_moves add column if not exists approved_at         timestamptz;
alter table public.inventory_moves add column if not exists reject_note         text;
alter table public.inventory_moves add column if not exists pending_changes     jsonb;

-- Stock trigger now also handles UPDATE: reverse the OLD effect, apply the NEW
-- effect (net-zero when qty/direction/spare are unchanged, e.g. metadata-only or
-- pending-only edits). So an approved edit re-syncs stock on the same row id.
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
  elsif (tg_op = 'UPDATE') then
    update public.spare_catalogue
      set current_stock = coalesce(current_stock,0) - (case when old.direction='in' then old.qty else -old.qty end),
          updated_at = now()
      where id = old.spare_id;
    update public.spare_catalogue
      set current_stock = coalesce(current_stock,0) + (case when new.direction='in' then new.qty else -new.qty end),
          updated_at = now()
      where id = new.spare_id;
  end if;
  return null;
end $$;
drop trigger if exists inv_move_apply on public.inventory_moves;
create trigger inv_move_apply after insert or delete or update on public.inventory_moves
  for each row execute function public.apply_inventory_move();

-- New inserts are always "approved" (first entry is free of approvals),
-- regardless of what the client sends.
create or replace function public.inventory_move_new_defaults()
returns trigger language plpgsql as $$
begin
  new.approval_status := 'approved';
  new.pending_changes := null;
  new.submitted_by := null; new.submitted_at := null; new.assigned_approver := null;
  return new;
end $$;
drop trigger if exists inv_move_defaults on public.inventory_moves;
create trigger inv_move_defaults before insert on public.inventory_moves
  for each row execute function public.inventory_move_new_defaults();

-- RLS: direct UPDATE is admin/approver only. Everyone else proposes via the RPC.
drop policy if exists inventory_moves_update on public.inventory_moves;
create policy inventory_moves_update on public.inventory_moves for update to authenticated
  using (public.has_role(array['admin','approver']::user_role[]));

-- ---------------------------------------------------------------------------
-- propose_inventory_edit — a non-admin parks the proposed values; nothing on the
-- live row (or stock) changes until approved. SECURITY DEFINER bypasses the
-- tightened UPDATE policy but only writes the pending fields.
-- ---------------------------------------------------------------------------
create or replace function public.propose_inventory_edit(p_id bigint, p_changes jsonb, p_approver uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.inventory_moves%rowtype;
begin
  select * into m from public.inventory_moves where id = p_id;
  if m.id is null then raise exception 'Inventory entry not found'; end if;
  if not public.is_internal() then raise exception 'You are not authorised to propose edits'; end if;
  update public.inventory_moves
     set pending_changes = p_changes,
         approval_status = 'submitted',
         submitted_by = auth.uid(), submitted_at = now(),
         assigned_approver = p_approver, reject_note = null
   where id = p_id;
end $$;
grant execute on function public.propose_inventory_edit(bigint, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_inventory_edit — apply the parked change to the live row (the stock
-- trigger re-syncs), then mark approved and clear the pending payload.
-- ---------------------------------------------------------------------------
create or replace function public.approve_inventory_edit(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare m public.inventory_moves%rowtype; c jsonb;
begin
  select * into m from public.inventory_moves where id = p_id;
  if m.id is null then raise exception 'Inventory entry not found'; end if;
  if not (public.has_role(array['admin','approver']::user_role[]) or m.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to approve this edit'; end if;
  c := coalesce(m.pending_changes, '{}'::jsonb);
  update public.inventory_moves set
    spare_id            = coalesce(nullif(c->>'spare_id','')::uuid, spare_id),
    qty                 = coalesce(nullif(c->>'qty','')::numeric, qty),
    direction           = coalesce(nullif(c->>'direction',''), direction),
    reason              = case when c ? 'reason'              then c->>'reason'              else reason end,
    moved_on            = coalesce(nullif(c->>'moved_on','')::date, moved_on),
    purchase_invoice_no = case when c ? 'purchase_invoice_no' then c->>'purchase_invoice_no' else purchase_invoice_no end,
    sales_invoice_no    = case when c ? 'sales_invoice_no'    then c->>'sales_invoice_no'    else sales_invoice_no end,
    approval_status = 'approved', approved_by = auth.uid(), approved_at = now(),
    pending_changes = null, reject_note = null
   where id = p_id;
end $$;
grant execute on function public.approve_inventory_edit(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_inventory_edit — discard the parked change; the live row was never
-- touched, so it simply returns to 'approved' with a rejection note.
-- ---------------------------------------------------------------------------
create or replace function public.reject_inventory_edit(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.inventory_moves%rowtype;
begin
  select * into m from public.inventory_moves where id = p_id;
  if m.id is null then raise exception 'Inventory entry not found'; end if;
  if not (public.has_role(array['admin','approver']::user_role[]) or m.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to reject this edit'; end if;
  update public.inventory_moves
     set pending_changes = null, approval_status = 'approved',
         reject_note = p_note, approved_by = auth.uid(), approved_at = now()
   where id = p_id;
end $$;
grant execute on function public.reject_inventory_edit(bigint, text) to authenticated;

-- ============================================================================
-- Done. Inventory entries: create freely; edits are held for approval and only
-- take effect (including stock) once the designated approver/admin approves.
-- ============================================================================
-- ============================================================================
-- 29. Contract numbers on agreements + let the team correct old spray entries
-- ----------------------------------------------------------------------------
-- (1) A contract / agreement number, assigned AFTER approval & signature and
--     BEFORE the agreement is marked executed. Shown on the Agreements list.
-- (2) Old Acre / Farmer rows imported from CSV were wrong. Allow anyone granted
--     the "Entries" tool (not just Farmer/Acre) to read & correct those rows,
--     so an admin can delegate the clean-up without opening farmer contacts.
-- Run this whole file in Supabase → SQL Editor.
-- ============================================================================

-- ---- (1) Contract number ----------------------------------------------------
alter table public.agreements add column if not exists agreement_no text;

-- Optional: keep assigned numbers unique (nulls allowed, so drafts are fine).
create unique index if not exists agreements_agreement_no_uidx
  on public.agreements (agreement_no) where agreement_no is not null;

-- Set / change the contract number. Only an approver/admin, and only once the
-- agreement has cleared approval (status approved or executed).
create or replace function public.set_agreement_no(p_id uuid, p_no text)
returns void language plpgsql security definer set search_path = public as $$
declare cur record;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can assign a contract number';
  end if;
  select status into cur from public.agreements where id = p_id;
  if not found then raise exception 'Agreement not found'; end if;
  if cur.status not in ('approved','executed') then
    raise exception 'Assign the contract number only after the agreement is approved';
  end if;
  update public.agreements
     set agreement_no = nullif(btrim(p_no),''), updated_at = now()
   where id = p_id;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'contract_no_set', 'agreement', p_id::text, p_no);
end $$;
grant execute on function public.set_agreement_no(uuid, text) to authenticated;

-- ---- (2) Entries-grant access to correct old spray data ---------------------
create or replace function public.has_entries_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists (select 1 from public.app_permissions p
                 where p.user_id = auth.uid()
                   and p.tool_key in ('entries','farmer','acre'));
$$;
grant execute on function public.has_entries_access() to authenticated;

-- farmer_sprays: allow the Entries grant to read + correct rows (phone stays
-- masked in the UI unless the user also holds the View-contacts capability).
drop policy if exists farmer_sprays_read   on public.farmer_sprays;
drop policy if exists farmer_sprays_insert on public.farmer_sprays;
drop policy if exists farmer_sprays_update on public.farmer_sprays;
create policy farmer_sprays_read   on public.farmer_sprays for select to authenticated
  using (public.has_farmer_access() or public.has_entries_access());
create policy farmer_sprays_insert on public.farmer_sprays for insert to authenticated
  with check (public.has_farmer_access() or public.has_entries_access());
create policy farmer_sprays_update on public.farmer_sprays for update to authenticated
  using (public.has_farmer_access() or public.has_entries_access());

-- acre_entries: make its update/delete gate explicit (Entries grant or admin).
alter table public.acre_entries enable row level security;
drop policy if exists acre_entries_update on public.acre_entries;
drop policy if exists acre_entries_delete on public.acre_entries;
create policy acre_entries_update on public.acre_entries for update to authenticated
  using (public.has_entries_access() or public.is_internal());
create policy acre_entries_delete on public.acre_entries for delete to authenticated
  using (public.has_role(array['admin']::user_role[]) or public.has_entries_access());
-- ============================================================================
-- 30. Let a user clear their own notification history
-- ----------------------------------------------------------------------------
-- "Mark all as read / Clear all" now removes the user's own notifications.
-- Adds a delete policy + grant (previously only select + update were allowed).
-- Run this in Supabase → SQL Editor.
-- ============================================================================

drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());

grant delete on public.notifications to authenticated;
-- ============================================================================
-- 31. (a) Acre entries: edit-requires-approval (change-on-approve)
--     (b) Catalogue: usage lookup so an item can only be deleted when unused
-- ----------------------------------------------------------------------------
-- (a) mirrors the inventory_moves pattern from sql/28: the first entry is free,
--     any later CHANGE by a non-approver is parked in pending_changes and only
--     applied to the row when an admin/approver approves it.
-- (b) catalogue_usage() reports stock + document/inventory references so the UI
--     can block deletion of an item that is actually in use.
-- Run this whole file in Supabase -> SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------- (a) ACRE --
alter table public.acre_entries add column if not exists approval_status   text not null default 'approved';
alter table public.acre_entries add column if not exists pending_changes   jsonb;
alter table public.acre_entries add column if not exists assigned_approver uuid references public.profiles(id);
alter table public.acre_entries add column if not exists submitted_by      uuid references public.profiles(id);
alter table public.acre_entries add column if not exists submitted_at      timestamptz;
alter table public.acre_entries add column if not exists approved_by       uuid references public.profiles(id);
alter table public.acre_entries add column if not exists approved_at       timestamptz;
alter table public.acre_entries add column if not exists reject_note       text;

-- New rows are live immediately (first entry is free of approval).
create or replace function public.acre_entry_new_defaults()
returns trigger language plpgsql as $$
begin
  new.approval_status := 'approved';
  new.pending_changes := null;
  return new;
end $$;
drop trigger if exists acre_entry_defaults on public.acre_entries;
create trigger acre_entry_defaults before insert on public.acre_entries
  for each row execute function public.acre_entry_new_defaults();

-- Only an approver/admin may write the row directly; everyone else must propose.
drop policy if exists acre_entries_update on public.acre_entries;
create policy acre_entries_update on public.acre_entries for update to authenticated
  using (public.has_role(array['admin','approver']::user_role[]));

-- Propose a change: parks the edit, does NOT touch the live figures.
create or replace function public.propose_acre_edit(p_id bigint, p_changes jsonb, p_approver uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_entries_access() then
    raise exception 'You do not have access to edit acre entries';
  end if;
  update public.acre_entries
     set pending_changes  = p_changes,
         approval_status  = 'submitted',
         assigned_approver= p_approver,
         submitted_by     = auth.uid(),
         submitted_at     = now(),
         reject_note      = null
   where id = p_id;
  if not found then raise exception 'Acre entry not found'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'edit_proposed', 'acre_entries', p_id::text, 'awaiting approval');
end $$;

-- Approve: apply the parked change to the live row.
create or replace function public.approve_acre_edit(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can approve';
  end if;
  select pending_changes into c from public.acre_entries where id = p_id;
  if c is null then raise exception 'Nothing pending on this entry'; end if;

  update public.acre_entries set
    entry_date   = coalesce((c->>'entry_date')::date,    entry_date),
    location_id  = coalesce(nullif(c->>'location_id','')::uuid, location_id),
    pilot_name   = coalesce(c->>'pilot_name',   pilot_name),
    acres        = coalesce((c->>'acres')::numeric,       acres),
    client_rate  = coalesce((c->>'client_rate')::numeric, client_rate),
    farmer_rate  = coalesce((c->>'farmer_rate')::numeric, farmer_rate),
    rate         = coalesce((c->>'rate')::numeric,        rate),
    amount       = coalesce((c->>'amount')::numeric,      amount),
    crop         = coalesce(c->>'crop',     crop),
    chemical     = coalesce(c->>'chemical', chemical),
    pending_changes = null,
    approval_status = 'approved',
    approved_by     = auth.uid(),
    approved_at     = now()
  where id = p_id;

  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'edit_approved', 'acre_entries', p_id::text, 'change applied');
end $$;

-- Reject: discard the parked change, live figures untouched.
create or replace function public.reject_acre_edit(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can reject';
  end if;
  update public.acre_entries
     set pending_changes = null, approval_status = 'approved',
         reject_note = p_note, approved_by = auth.uid(), approved_at = now()
   where id = p_id;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'edit_rejected', 'acre_entries', p_id::text, p_note);
end $$;

grant execute on function public.propose_acre_edit(bigint, jsonb, uuid) to authenticated;
grant execute on function public.approve_acre_edit(bigint)             to authenticated;
grant execute on function public.reject_acre_edit(bigint, text)        to authenticated;

-- ----------------------------------------------------------- (b) CATALOGUE --
-- Reports whether a catalogue item is in use, so the UI can block deletion.
-- Spares are referenced on documents by line_items->>'_spareId'; services (and
-- spares) also match on the line item description carrying the item name.
create or replace function public.catalogue_usage(p_kind text, p_id uuid, p_name text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_docs int := 0; v_moves int := 0; v_stock numeric := 0; v_sample text;
begin
  select count(*) into v_docs
    from public.documents d
   where exists (
     select 1 from jsonb_array_elements(coalesce(d.line_items, '[]'::jsonb)) li
      where (p_id is not null and (li->>'_spareId') = p_id::text)
         or (coalesce(p_name,'') <> '' and lower(btrim(coalesce(li->>'desc',''))) = lower(btrim(p_name)))
   );

  select string_agg(x.number, ', ') into v_sample from (
    select d.number from public.documents d
     where exists (
       select 1 from jsonb_array_elements(coalesce(d.line_items, '[]'::jsonb)) li
        where (p_id is not null and (li->>'_spareId') = p_id::text)
           or (coalesce(p_name,'') <> '' and lower(btrim(coalesce(li->>'desc',''))) = lower(btrim(p_name)))
     )
     order by d.created_at desc limit 5) x;

  if p_kind = 'spare' then
    select count(*) into v_moves from public.inventory_moves where spare_id = p_id;
    select coalesce(current_stock, 0) into v_stock from public.spare_catalogue where id = p_id;
  end if;

  return jsonb_build_object('docs', v_docs, 'moves', v_moves,
                            'stock', coalesce(v_stock,0), 'sample', coalesce(v_sample,''));
end $$;
grant execute on function public.catalogue_usage(text, uuid, text) to authenticated;
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
-- ============================================================================
-- 34. Bootstrap the Pilots list from the pilot names already in the data
-- ----------------------------------------------------------------------------
-- Creates one pilot record per DISTINCT existing pilot_name (case-insensitive)
-- from acre_entries and farmer_sprays, so the team has something to select from
-- immediately. These are marked source='imported' and have NO vendor yet — the
-- team edits each one to set the vendor and delete/merge duplicates.
--
-- Old rows are NOT touched: acre_entries.pilot_id stays null and the historic
-- pilot_name text is preserved, so no existing data changes.
-- Safe to re-run (it skips names that already exist).
-- ============================================================================

-- Imported pilots have no employer yet, so vendor becomes optional.
-- New pilots created in the app still require a vendor (enforced in the UI).
alter table public.pilots alter column vendor_id drop not null;
alter table public.pilots add column if not exists source text not null default 'manual';

-- Stop duplicate imported names sneaking in (only applies while vendor is null,
-- so two different vendors may still each employ a pilot with the same name).
create unique index if not exists pilots_imported_name_uidx
  on public.pilots (lower(btrim(name))) where vendor_id is null;

-- ---- the import -----------------------------------------------------------
with names as (
  select distinct btrim(pilot_name) as nm
    from public.acre_entries
   where coalesce(btrim(pilot_name),'') <> ''
  union
  select distinct btrim(pilot_name)
    from public.farmer_sprays
   where coalesce(btrim(pilot_name),'') <> ''
), dedup as (
  -- one row per name, case-insensitively (keeps the first spelling seen)
  select distinct on (lower(nm)) nm from names order by lower(nm), nm
)
insert into public.pilots (vendor_id, name, source, is_active, notes)
select null, d.nm, 'imported', true,
       'Imported from existing entries — set the vendor, and delete any duplicate spellings.'
  from dedup d
 where not exists (
   select 1 from public.pilots p where lower(btrim(p.name)) = lower(d.nm)
 );

-- ---- how many did we create? ----------------------------------------------
select count(*) filter (where source='imported')                              as imported_pilots,
       count(*) filter (where source='imported' and vendor_id is null)        as still_need_a_vendor,
       count(*)                                                               as total_pilots
  from public.pilots;

-- ---- let the team clean up duplicates -------------------------------------
-- A pilot may only be deleted when nothing points at it: no location
-- assignment and no acre entry linked by pilot_id. Historic text names are
-- unaffected, so deleting a duplicate never touches past data.
create or replace function public.delete_pilot(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_assign int; v_acres int;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select count(*) into v_assign from public.pilot_assignments where pilot_id = p_id;
  select count(*) into v_acres  from public.acre_entries      where pilot_id = p_id;
  if v_assign > 0 then
    raise exception 'Cannot delete: this pilot has % location assignment(s). Close and remove them first.', v_assign;
  end if;
  if v_acres > 0 then
    raise exception 'Cannot delete: % acre entr(ies) are linked to this pilot.', v_acres;
  end if;
  delete from public.pilots where id = p_id;
  if not found then raise exception 'Pilot not found'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'deleted', 'pilots', p_id::text, 'duplicate cleanup');
end $$;
grant execute on function public.delete_pilot(uuid) to authenticated;
-- ============================================================================
-- 35. Locations carry BOTH rates and BOTH billing parties; entry is
--     location-first and carries the selected pilot.
-- ----------------------------------------------------------------------------
-- A location now holds:
--   farmer_rate   -> billed to farmer_bill_to  (0% GST, "Bill of Supply")
--   client_rate   -> billed to client_bill_to  (18% GST, Marketing Expense /
--                    Subsidy per that client's label). May be 0 — then no
--                    client-side bill is raised at all.
-- Acre data is captured against the LOCATION; invoicing filters location first,
-- then the client, because one location can bill two different clients.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- ------------------------------------------------------- LOCATION RATES ---
alter table public.spray_locations add column if not exists farmer_rate    numeric;
alter table public.spray_locations add column if not exists client_rate    numeric not null default 0;
alter table public.spray_locations add column if not exists farmer_bill_to uuid references public.clients(id);
alter table public.spray_locations add column if not exists client_bill_to uuid references public.clients(id);

-- Carry the old single default rate over as the farmer rate (once).
update public.spray_locations
   set farmer_rate = nullif(rates->>'default','')::numeric
 where farmer_rate is null
   and coalesce(rates->>'default','') <> '';

-- Default the farmer billing party to the location's existing client.
update public.spray_locations
   set farmer_bill_to = client_id
 where farmer_bill_to is null and client_id is not null;

-- A client-rate component must name who gets billed for it.
alter table public.spray_locations drop constraint if exists loc_client_rate_party_chk;
alter table public.spray_locations add constraint loc_client_rate_party_chk
  check (coalesce(client_rate,0) = 0 or client_bill_to is not null);

-- --------------------------------------------- ENTRY IS LOCATION-FIRST ----
alter table public.daily_submissions add column if not exists location_id uuid references public.spray_locations(id);

-- ---------------------------------------------------- POST THE DAY -------
-- Now resolves the location by ID (falling back to the old name lookup for
-- historic rows) and carries pilot_id through to acre_entries.
create or replace function public.post_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     public.daily_submissions%rowtype;
  r     jsonb;
  loc   uuid;
  sid   uuid;
  acres numeric; cr numeric; fr numeric; amt numeric; pid uuid;
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
    pid   := nullif(r->>'pilot_id','')::uuid;
    if acres = 0 and coalesce(trim(r->>'farmer'),'') = '' then continue; end if;
    amt := acres * (cr + fr);
    sid := gen_random_uuid();
    sids := array_append(sids, sid::text);

    insert into public.acre_entries
      (entry_date, location_id, pilot_id, pilot_name, acres, rate, client_rate, farmer_rate,
       amount, crop, chemical, source_id, created_by)
    values
      (s.entry_date, loc, pid, nullif(r->>'pilot',''), acres, nullif(cr+fr,0), nullif(cr,0), nullif(fr,0),
       nullif(amt,0), nullif(r->>'crop',''), nullif(r->>'chemical',''), sid, s.submitted_by);

    insert into public.farmer_sprays
      (spray_date, pilot_name, client_name, farmer_name, contact_no, village, state, district,
       chemical_company, crop, acre, rate, amount, gps_image_present, source_id, created_by)
    values
      (s.entry_date, nullif(r->>'pilot',''), s.client_name, nullif(r->>'farmer',''), nullif(r->>'phone',''),
       nullif(r->>'village',''), s.state, s.district, nullif(r->>'chemical',''), nullif(r->>'crop',''),
       nullif(acres,0), nullif(cr+fr,0), nullif(amt,0), coalesce((r->>'gps')::boolean,false), sid, s.submitted_by);
  end loop;

  update public.daily_submissions
     set approval_status='approved', approved_by=auth.uid(), approved_at=now(),
         posted=true, posted_source_ids=sids, updated_at=now()
   where id = p_id;
end $$;

-- ------------------------------------------- BILLABLE ACRE WORK VIEW ------
-- One row per acre entry with BOTH billing sides resolved, so invoicing can
-- filter by location first and then by client.
create or replace view public.v_acre_billing as
  select a.id, a.entry_date, a.acres, a.crop, a.chemical,
         a.location_id, l.name as location_name, l.state, l.district,
         a.pilot_id, coalesce(p.name, a.pilot_name) as pilot_name,
         coalesce(a.farmer_rate, l.farmer_rate, 0) as farmer_rate,
         coalesce(a.client_rate, l.client_rate, 0) as client_rate,
         l.farmer_bill_to, fc.firm_name as farmer_client_name,
         l.client_bill_to, cc.firm_name as client_client_name,
         cc.client_rate_label,
         a.farmer_doc_id, a.client_doc_id,
         round(a.acres * coalesce(a.farmer_rate, l.farmer_rate, 0), 2) as farmer_amount,
         round(a.acres * coalesce(a.client_rate, l.client_rate, 0), 2) as client_amount
    from public.acre_entries a
    join public.spray_locations l on l.id = a.location_id
    left join public.pilots  p  on p.id  = a.pilot_id
    left join public.clients fc on fc.id = l.farmer_bill_to
    left join public.clients cc on cc.id = l.client_bill_to;
grant select on public.v_acre_billing to authenticated;
-- ============================================================================
-- 36. Stamp acre rows as billed, and release them if the document is deleted
-- ----------------------------------------------------------------------------
-- Acre rows are locked to approver-only UPDATE (sql/31), so billing marks go
-- through a SECURITY DEFINER function — that way anyone allowed to raise an
-- invoice can stamp the rows, without opening up acre editing.
-- Each side is stamped independently: 'farmer' (0% Bill of Supply) and
-- 'client' (18% Marketing Expense / Subsidy).
-- ============================================================================

create or replace function public.mark_acre_billed(p_ids bigint[], p_doc uuid, p_side text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if p_side = 'farmer' then
    update public.acre_entries
       set farmer_doc_id = p_doc, farmer_billed_at = now()
     where id = any(p_ids) and farmer_doc_id is null;
  elsif p_side = 'client' then
    update public.acre_entries
       set client_doc_id = p_doc, client_billed_at = now()
     where id = any(p_ids) and client_doc_id is null;
  else
    raise exception 'side must be farmer or client';
  end if;
  get diagnostics n = row_count;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'acre_billed', 'documents', p_doc::text, n||' acre row(s) · '||p_side);
  return n;
end $$;

-- Releasing lets the rows be re-billed (used when a document is deleted).
create or replace function public.unmark_acre_billed(p_doc uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; m integer;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  update public.acre_entries set farmer_doc_id = null, farmer_billed_at = null
   where farmer_doc_id = p_doc;
  get diagnostics n = row_count;
  update public.acre_entries set client_doc_id = null, client_billed_at = null
   where client_doc_id = p_doc;
  get diagnostics m = row_count;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'acre_unbilled', 'documents', p_doc::text, (n+m)||' acre row(s) released');
  return n + m;
end $$;

grant execute on function public.mark_acre_billed(bigint[], uuid, text) to authenticated;
grant execute on function public.unmark_acre_billed(uuid)               to authenticated;

-- ---- unbilled summary for the dashboard signal -----------------------------
create or replace view public.v_acre_unbilled_summary as
  select l.id as location_id, l.name as location_name,
         l.farmer_bill_to, fc.firm_name as farmer_client_name,
         l.client_bill_to, cc.firm_name as client_client_name,
         count(*) filter (where a.farmer_doc_id is null)                        as farmer_rows,
         round(sum(a.acres) filter (where a.farmer_doc_id is null), 2)          as farmer_acres,
         round(sum(a.acres * coalesce(a.farmer_rate, l.farmer_rate, 0))
                 filter (where a.farmer_doc_id is null), 2)                     as farmer_value,
         count(*) filter (where a.client_doc_id is null
                            and coalesce(l.client_rate,0) > 0)                  as client_rows,
         round(sum(a.acres * coalesce(a.client_rate, l.client_rate, 0))
                 filter (where a.client_doc_id is null
                           and coalesce(l.client_rate,0) > 0), 2)               as client_value,
         min(a.entry_date) as oldest_unbilled
    from public.acre_entries a
    join public.spray_locations l on l.id = a.location_id
    left join public.clients fc on fc.id = l.farmer_bill_to
    left join public.clients cc on cc.id = l.client_bill_to
   where a.farmer_doc_id is null
      or (a.client_doc_id is null and coalesce(l.client_rate,0) > 0)
   group by l.id, l.name, l.farmer_bill_to, fc.firm_name, l.client_bill_to, cc.firm_name;
grant select on public.v_acre_unbilled_summary to authenticated;
-- ============================================================================
-- 37. Payment status flows back to the acre data + partial release for credits
-- ----------------------------------------------------------------------------
-- (10) Marking an invoice paid now shows against the acre rows it billed, so
--      you can see exactly which sprayed acres are still awaiting payment.
-- (9)  Credit notes raised from acre data release the credited rows so they can
--      be billed again correctly.
-- ============================================================================

-- ---- per-acre-row billing + payment status --------------------------------
create or replace view public.v_acre_payment as
with doc_paid as (
  select d.id,
         coalesce((d.totals->>'total')::numeric, 0) as total,
         coalesce((select sum(p.amount) from public.payments p where p.document_id = d.id), 0) as paid
    from public.documents d
)
select a.id                        as acre_id,
       a.entry_date, a.location_id, a.acres, a.pilot_id, a.pilot_name,
       -- farmer side (0% Bill of Supply)
       a.farmer_doc_id, fd.number  as farmer_doc_no,
       fp.total as farmer_total, fp.paid as farmer_paid,
       case when a.farmer_doc_id is null                       then 'unbilled'
            when fp.paid >= fp.total - 0.01 and fp.total > 0    then 'paid'
            when fp.paid > 0                                    then 'partial'
            else 'unpaid' end      as farmer_status,
       -- client side (18% Marketing Expense / Subsidy)
       a.client_doc_id, cd.number  as client_doc_no,
       cp.total as client_total, cp.paid as client_paid,
       case when a.client_doc_id is null                       then 'unbilled'
            when cp.paid >= cp.total - 0.01 and cp.total > 0    then 'paid'
            when cp.paid > 0                                    then 'partial'
            else 'unpaid' end      as client_status
  from public.acre_entries a
  left join public.documents fd on fd.id = a.farmer_doc_id
  left join doc_paid        fp on fp.id  = a.farmer_doc_id
  left join public.documents cd on cd.id = a.client_doc_id
  left join doc_paid        cp on cp.id  = a.client_doc_id;
grant select on public.v_acre_payment to authenticated;

-- ---- release specific rows (used when part of an invoice is credited) -----
create or replace function public.release_acre_rows(p_ids bigint[], p_side text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if p_side = 'farmer' then
    update public.acre_entries set farmer_doc_id = null, farmer_billed_at = null
     where id = any(p_ids);
  elsif p_side = 'client' then
    update public.acre_entries set client_doc_id = null, client_billed_at = null
     where id = any(p_ids);
  else
    raise exception 'side must be farmer or client';
  end if;
  get diagnostics n = row_count;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'acre_released', 'acre_entries', '', n||' row(s) released for re-billing · '||p_side);
  return n;
end $$;
grant execute on function public.release_acre_rows(bigint[], text) to authenticated;

-- ---- roll-up of unpaid billed acre work, for the dashboard ---------------
create or replace view public.v_acre_payment_summary as
  select l.id as location_id, l.name as location_name,
         count(*) filter (where v.farmer_status in ('unpaid','partial'))            as farmer_open_rows,
         round(sum(v.acres) filter (where v.farmer_status in ('unpaid','partial')),2) as farmer_open_acres,
         count(*) filter (where v.client_status in ('unpaid','partial'))            as client_open_rows,
         min(v.entry_date) filter (where v.farmer_status in ('unpaid','partial'))   as oldest_unpaid
    from public.v_acre_payment v
    join public.spray_locations l on l.id = v.location_id
   where v.farmer_status in ('unpaid','partial') or v.client_status in ('unpaid','partial')
   group by l.id, l.name;
grant select on public.v_acre_payment_summary to authenticated;
-- ============================================================================
-- 38. Vendor acreage report + auto-numbering series
-- ----------------------------------------------------------------------------
-- (1) v_vendor_acreage — every acre row resolved to the VENDOR who employs the
--     pilot, so a period statement can be shared with the vendor to reconcile
--     against their own billing before we invoice the client.
--     NOTE: this resolves through acre_entries.pilot_id, so it covers work
--     entered after the Pilots master went live. Older rows that only carry a
--     text pilot_name have no vendor to attribute to and are excluded.
-- (3) Auto-numbering: client codes + agreement numbers, alongside the existing
--     next_doc_seq() used by invoices / quotations / POs / credit notes.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- --------------------------------------------------- VENDOR ACREAGE ------
create or replace view public.v_vendor_acreage as
  select v.id                                   as vendor_id,
         coalesce(v.firm_name, v.name)          as vendor_name,
         p.id                                   as pilot_id,
         p.name                                 as pilot_name,
         p.phone                                as pilot_phone,
         a.id                                   as acre_id,
         a.entry_date,
         a.location_id,
         l.name                                 as location_name,
         cl.firm_name                           as client_name,
         a.acres,
         a.crop, a.chemical,
         coalesce(a.farmer_rate, l.farmer_rate, 0) as farmer_rate,
         coalesce(a.client_rate, l.client_rate, 0) as client_rate,
         round(a.acres * coalesce(a.farmer_rate, l.farmer_rate, 0), 2) as farmer_amount,
         round(a.acres * coalesce(a.client_rate, l.client_rate, 0), 2) as client_amount,
         round(a.acres * (coalesce(a.farmer_rate, l.farmer_rate, 0)
                        + coalesce(a.client_rate, l.client_rate, 0)), 2) as total_amount,
         a.farmer_doc_id, a.client_doc_id,
         (a.farmer_doc_id is not null) as farmer_billed,
         (a.client_doc_id is not null) as client_billed
    from public.acre_entries a
    join public.pilots  p  on p.id  = a.pilot_id
    join public.vendors v  on v.id  = p.vendor_id
    left join public.spray_locations l on l.id = a.location_id
    left join public.clients cl        on cl.id = l.client_id;
grant select on public.v_vendor_acreage to authenticated;

-- ------------------------------------------------------ NUMBER SERIES ----
-- Client code, e.g. DCB/CL/0007
alter table public.clients add column if not exists client_code text;
create unique index if not exists clients_code_uidx
  on public.clients (client_code) where client_code is not null;

create or replace function public.next_client_code()
returns text language sql stable security definer set search_path = public as $$
  select 'DCB/CL/' || lpad((
    coalesce(max(nullif(regexp_replace(client_code, '^.*/', ''), ''))::int, 0) + 1
  )::text, 4, '0')
  from public.clients
  where client_code ~ '^DCB/CL/[0-9]+$';
$$;

-- Agreement / contract number, e.g. DCB/AGR/26-27/0004
create or replace function public.next_agreement_no(p_fy text)
returns text language sql stable security definer set search_path = public as $$
  select 'DCB/AGR/' || p_fy || '/' || lpad((
    coalesce(max(nullif(regexp_replace(agreement_no, '^.*/', ''), ''))::int, 0) + 1
  )::text, 4, '0')
  from public.agreements
  where agreement_no like 'DCB/AGR/' || p_fy || '/%'
    and agreement_no ~ '[0-9]+$';
$$;

grant execute on function public.next_client_code()        to authenticated;
grant execute on function public.next_agreement_no(text)   to authenticated;
-- ============================================================================
-- 39. Item cost on the catalogue (base + shipping) to drive margin review
-- ----------------------------------------------------------------------------
-- Cost is INTERNAL: it is snapshotted onto the document line when an item is
-- picked, shown while building and reviewing the document, and never printed
-- on the customer's copy.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

alter table public.service_catalogue add column if not exists cost_base     numeric not null default 0;
alter table public.service_catalogue add column if not exists cost_shipping numeric not null default 0;

alter table public.spare_catalogue   add column if not exists cost_base     numeric not null default 0;
alter table public.spare_catalogue   add column if not exists cost_shipping numeric not null default 0;

comment on column public.service_catalogue.cost_base     is 'Internal landed cost before shipping — never printed on documents';
comment on column public.service_catalogue.cost_shipping is 'Internal shipping/freight cost — never printed on documents';
comment on column public.spare_catalogue.cost_base       is 'Internal landed cost before shipping — never printed on documents';
comment on column public.spare_catalogue.cost_shipping   is 'Internal shipping/freight cost — never printed on documents';
-- ============================================================================
-- 40. Finance & Accounting — Phase A
--     Accounts, supplier invoices (payables), expenses, money movements and the
--     daily close. See ACCOUNTING_PLAN.md for the agreed design.
-- ----------------------------------------------------------------------------
-- Rules baked in:
--   • "Paid" means the day the money left the account (a cheque handed over is
--     'cheque_issued' and does NOT hit the day book).
--   • Cash in hand is a separate account with its own daily close.
--   • Opening balance is never typed — it chains from the previous actual close.
--   • Only an approver may close or reopen a day; both are audit-logged.
--   • A day may be closed with a difference, but the note is mandatory and it
--     is flagged.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- ----------------------------------------------------------- ACCOUNTS -----
create table if not exists public.cash_accounts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  kind              text not null check (kind in ('bank','cash')),
  bank_name         text,
  account_no_masked text,
  opening_balance   numeric not null default 0,
  opened_on         date not null default current_date,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- seed the two accounts (idempotent)
insert into public.cash_accounts (name, kind, bank_name, opening_balance, opened_on)
select 'DCB Bank', 'bank', 'DroCon Bharat Pvt Ltd', 101524.72, current_date
 where not exists (select 1 from public.cash_accounts where kind='bank');
insert into public.cash_accounts (name, kind, opening_balance, opened_on)
select 'Cash in hand', 'cash', 0, current_date
 where not exists (select 1 from public.cash_accounts where kind='cash');

-- --------------------------------------------- SUPPLIER INVOICES ---------
create table if not exists public.payables (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid references public.vendors(id),
  vendor_invoice_no text,
  invoice_date      date not null default current_date,
  due_date          date,
  amount            numeric not null default 0,
  gst_amount        numeric not null default 0,
  total             numeric not null default 0,
  category          text,
  note              text,
  status            text not null default 'unpaid'
                    check (status in ('unpaid','cheque_issued','part_paid','paid')),
  approval_status   text not null default 'approved',
  assigned_approver uuid references public.profiles(id),
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);
create index if not exists payables_vendor_idx on public.payables(vendor_id);
create index if not exists payables_status_idx on public.payables(status);

-- ------------------------------------------------------- EXPENSES --------
create table if not exists public.expense_categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  is_active boolean not null default true
);
insert into public.expense_categories (name)
select x from unnest(array['Travel','Fuel','Accommodation','Food & M&IE','Repairs & Maintenance',
                           'Spares','Office','Telephone & Internet','Professional Fees',
                           'Bank Charges','Freight','Miscellaneous']) x
 where not exists (select 1 from public.expense_categories);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category_id  uuid references public.expense_categories(id),
  payee_kind   text check (payee_kind in ('vendor','employee','other')),
  vendor_id    uuid references public.vendors(id),
  employee_id  uuid,
  payee_text   text,
  amount       numeric not null default 0,
  gst_amount   numeric not null default 0,
  total        numeric not null default 0,
  has_bill     boolean not null default false,
  bill_no      text,
  note         text,
  status       text not null default 'unpaid' check (status in ('unpaid','paid')),
  approval_status   text not null default 'approved',
  assigned_approver uuid references public.profiles(id),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses(expense_date);

-- ------------------------------------------------- MONEY MOVEMENTS -------
-- The single source of truth for money OUT, and for any IN that is not a
-- sales-invoice receipt (those stay in public.payments).
create table if not exists public.cash_txns (
  id         bigint generated always as identity primary key,
  account_id uuid not null references public.cash_accounts(id),
  direction  text not null check (direction in ('in','out')),
  txn_date   date not null default current_date,
  amount     numeric not null check (amount > 0),
  mode       text,
  ref_type   text,      -- payable | expense | advance | salary | transfer | other
  ref_id     text,
  note       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists cash_txns_acct_date_idx on public.cash_txns(account_id, txn_date);

-- receipts need to know which account they landed in
alter table public.payments add column if not exists account_id uuid references public.cash_accounts(id);
update public.payments p set account_id = (select id from public.cash_accounts where kind='bank' limit 1)
 where p.account_id is null;

-- ------------------------------------------------------ DAILY CLOSE ------
create table if not exists public.day_close (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.cash_accounts(id),
  close_date       date not null,
  opening          numeric not null,
  receipts         numeric not null,
  payments         numeric not null,
  expected_closing numeric not null,
  actual_closing   numeric not null,
  difference       numeric not null,
  status           text not null default 'closed' check (status in ('closed')),
  note             text,
  closed_by        uuid references public.profiles(id),
  closed_at        timestamptz not null default now(),
  unique (account_id, close_date)
);

-- Position for a given account+date. Opening chains from the last close.
create or replace function public.day_position(p_account uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_rec numeric; v_pay numeric; v_acc public.cash_accounts%rowtype;
begin
  select * into v_acc from public.cash_accounts where id = p_account;
  if not found then raise exception 'Account not found'; end if;

  select actual_closing into v_open from public.day_close
   where account_id = p_account and close_date < p_date
   order by close_date desc limit 1;
  if v_open is null then v_open := v_acc.opening_balance; end if;

  select coalesce(sum(amount),0) into v_rec from (
    select amount from public.cash_txns
     where account_id = p_account and txn_date = p_date and direction = 'in'
    union all
    select amount from public.payments
     where account_id = p_account and paid_on = p_date
  ) s;

  select coalesce(sum(amount),0) into v_pay from public.cash_txns
   where account_id = p_account and txn_date = p_date and direction = 'out';

  return jsonb_build_object(
    'opening', round(v_open,2), 'receipts', round(v_rec,2), 'payments', round(v_pay,2),
    'expected', round(v_open + v_rec - v_pay, 2),
    'closed', exists (select 1 from public.day_close where account_id=p_account and close_date=p_date)
  );
end $$;
grant execute on function public.day_position(uuid, date) to authenticated;

-- Close a day. Approver/admin only. Difference allowed, but the note is required.
create or replace function public.close_day(p_account uuid, p_date date, p_actual numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pos jsonb; v_diff numeric; v_id uuid;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can close a day';
  end if;
  if exists (select 1 from public.day_close where account_id=p_account and close_date=p_date) then
    raise exception 'That day is already closed';
  end if;
  pos := public.day_position(p_account, p_date);
  v_diff := round(p_actual - (pos->>'expected')::numeric, 2);
  if v_diff <> 0 and coalesce(btrim(p_note),'') = '' then
    raise exception 'The closing balance does not match (difference %). A note is required to close with a difference.', v_diff;
  end if;

  insert into public.day_close(account_id, close_date, opening, receipts, payments,
                               expected_closing, actual_closing, difference, note, closed_by)
  values (p_account, p_date, (pos->>'opening')::numeric, (pos->>'receipts')::numeric,
          (pos->>'payments')::numeric, (pos->>'expected')::numeric, p_actual, v_diff, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'day_closed', 'day_close', v_id::text,
            p_date::text||' · difference '||v_diff);
  return v_id;
end $$;
grant execute on function public.close_day(uuid, date, numeric, text) to authenticated;

-- Reopen a closed day. Approver/admin only, audit-logged.
create or replace function public.reopen_day(p_account uuid, p_date date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can reopen a day';
  end if;
  if exists (select 1 from public.day_close
              where account_id=p_account and close_date > p_date) then
    raise exception 'A later day is already closed — reopen the most recent day first';
  end if;
  delete from public.day_close where account_id=p_account and close_date=p_date;
  if not found then raise exception 'That day is not closed'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'day_reopened', 'day_close', p_account::text, p_date::text||' · '||coalesce(p_note,''));
end $$;
grant execute on function public.reopen_day(uuid, date, text) to authenticated;

-- Refuse movements dated into a day that is already closed.
create or replace function public.guard_closed_day()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.day_close
              where account_id = new.account_id
                and close_date = coalesce(new.txn_date, new.paid_on)) then
    raise exception 'That day is closed. An approver must reopen it before entering or changing anything dated %',
      coalesce(new.txn_date, new.paid_on);
  end if;
  return new;
end $$;
drop trigger if exists cash_txns_closed_guard on public.cash_txns;
create trigger cash_txns_closed_guard before insert or update on public.cash_txns
  for each row execute function public.guard_closed_day();

-- ------------------------------------------------------------ RLS --------
do $$ declare t text;
begin
  foreach t in array array['cash_accounts','payables','expense_categories','expenses','cash_txns','day_close'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format('drop policy if exists %I_upd on public.%I;', t, t);
    execute format('drop policy if exists %I_del on public.%I;', t, t);
    execute format('create policy %I_read  on public.%I for select to authenticated using (public.is_internal());', t, t);
    execute format('create policy %I_write on public.%I for insert to authenticated with check (public.is_internal());', t, t);
    execute format('create policy %I_upd   on public.%I for update to authenticated using (public.is_internal());', t, t);
    execute format('create policy %I_del   on public.%I for delete to authenticated using (public.has_role(array[''admin'']::user_role[]));', t, t);
  end loop;
end $$;

-- --------------------------------------------------------- DASHBOARD -----
-- Red flags: days closed with a difference, and gaps that were never closed.
create or replace view public.v_accounting_flags as
  select a.id as account_id, a.name as account_name,
         d.close_date, d.difference, d.note, d.closed_at
    from public.day_close d
    join public.cash_accounts a on a.id = d.account_id
   where d.difference <> 0;
grant select on public.v_accounting_flags to authenticated;

-- Live payables position.
create or replace view public.v_payables_open as
  select p.*, coalesce(v.firm_name, v.name) as vendor_name,
         p.total - coalesce((select sum(c.amount) from public.cash_txns c
                              where c.ref_type='payable' and c.ref_id = p.id::text), 0) as balance
    from public.payables p
    left join public.vendors v on v.id = p.vendor_id
   where p.status <> 'paid';
grant select on public.v_payables_open to authenticated;
-- ============================================================================
-- 41. Accounting Phase B/C — Advances, and the live position dashboard
-- ----------------------------------------------------------------------------
-- An advance is money paid out BEFORE the expense is known (tour, fuel, vendor
-- advance against a PO). It stays outstanding until settled — either by the
-- expenses the person actually incurred, or by returning the balance.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

create table if not exists public.advances (
  id          uuid primary key default gen_random_uuid(),
  party_kind  text not null check (party_kind in ('employee','vendor','other')),
  employee_id uuid,
  vendor_id   uuid references public.vendors(id),
  payee_text  text,
  amount      numeric not null check (amount > 0),
  issued_on   date not null default current_date,
  purpose     text,
  status      text not null default 'open' check (status in ('open','settled')),
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists advances_status_idx on public.advances(status);

-- How an advance was accounted for: expenses it covered, or cash returned.
create table if not exists public.advance_settlements (
  id         uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.advances(id) on delete cascade,
  kind       text not null check (kind in ('expense','repayment','write_off')),
  ref_id     text,                       -- expenses.id when kind='expense'
  amount     numeric not null check (amount > 0),
  settled_on date not null default current_date,
  note       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists adv_settle_idx on public.advance_settlements(advance_id);

-- Outstanding advances, with who holds the money.
create or replace view public.v_advances_open as
  select a.*,
         coalesce(v.firm_name, v.name, a.payee_text) as party_name,
         coalesce((select sum(s.amount) from public.advance_settlements s
                    where s.advance_id = a.id), 0)   as settled,
         a.amount - coalesce((select sum(s.amount) from public.advance_settlements s
                               where s.advance_id = a.id), 0) as outstanding
    from public.advances a
    left join public.vendors v on v.id = a.vendor_id;
grant select on public.v_advances_open to authenticated;

-- Close an advance once it is fully accounted for (or write the rest off).
create or replace function public.settle_advance(p_id uuid, p_kind text, p_ref text,
                                                 p_amount numeric, p_on date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_out numeric;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  insert into public.advance_settlements(advance_id, kind, ref_id, amount, settled_on, note, created_by)
    values (p_id, p_kind, p_ref, p_amount, coalesce(p_on, current_date), p_note, auth.uid());

  select outstanding into v_out from public.v_advances_open where id = p_id;
  if v_out <= 0.005 then
    update public.advances set status='settled' where id = p_id;
  end if;

  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'advance_settled', 'advances', p_id::text, p_kind||' '||p_amount);
end $$;
grant execute on function public.settle_advance(uuid, text, text, numeric, date, text) to authenticated;

-- ------------------------------------------------- LIVE POSITION ---------
-- Days that have money movement but were never closed — the other red flag.
create or replace view public.v_days_unclosed as
  select s.account_id, a.name as account_name, s.day
    from (
      select account_id, txn_date as day from public.cash_txns
      union
      select account_id, paid_on  as day from public.payments where account_id is not null
    ) s
    join public.cash_accounts a on a.id = s.account_id
   where not exists (select 1 from public.day_close d
                      where d.account_id = s.account_id and d.close_date = s.day)
   group by s.account_id, a.name, s.day;
grant select on public.v_days_unclosed to authenticated;

-- Receivables position (sales invoices less receipts and credit notes).
create or replace view public.v_receivables_open as
  select d.id, d.number, d.doc_date, d.entity,
         coalesce((d.party_snapshot->>'firmName'), (d.party_snapshot->>'name')) as party_name,
         coalesce((d.totals->>'total')::numeric, 0) as invoiced,
         coalesce((select sum(p.amount) from public.payments p where p.document_id = d.id), 0) as received,
         coalesce((select sum(coalesce((c.totals->>'total')::numeric,0)) from public.documents c
                    where c.doc_type='credit_note' and c.related_doc_id = d.id), 0) as credited,
         coalesce((d.totals->>'total')::numeric, 0)
           - coalesce((select sum(p.amount) from public.payments p where p.document_id = d.id), 0)
           - coalesce((select sum(coalesce((c.totals->>'total')::numeric,0)) from public.documents c
                        where c.doc_type='credit_note' and c.related_doc_id = d.id), 0) as balance,
         greatest(0, current_date - d.doc_date) as age_days
    from public.documents d
   where d.doc_type = 'invoice';
grant select on public.v_receivables_open to authenticated;
-- ============================================================================
-- 42. Accounting Phase D — journal posting + "reconcile from" date
-- ----------------------------------------------------------------------------
-- (a) reconcile_from: stops the unclosed-days flag lighting up for every
--     historic receipt that predates the Day Book.
-- (b) Every money movement now posts double-entry into the existing
--     accounting_entries journal, giving a real trial balance. Doing this now,
--     while there is almost no data, avoids a painful retrofit later.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- --------------------------------------------------- (a) RECONCILE FROM --
alter table public.cash_accounts add column if not exists reconcile_from date;
update public.cash_accounts set reconcile_from = opened_on where reconcile_from is null;

-- only flag unclosed days on/after the account's reconcile_from date
create or replace view public.v_days_unclosed as
  select s.account_id, a.name as account_name, s.day
    from (
      select account_id, txn_date as day from public.cash_txns
      union
      select account_id, paid_on  as day from public.payments where account_id is not null
    ) s
    join public.cash_accounts a on a.id = s.account_id
   where s.day >= coalesce(a.reconcile_from, a.opened_on)
     and not exists (select 1 from public.day_close d
                      where d.account_id = s.account_id and d.close_date = s.day)
   group by s.account_id, a.name, s.day;
grant select on public.v_days_unclosed to authenticated;

-- ------------------------------------------------------- (b) JOURNAL ----
-- Ledger name for an account row.
create or replace function public.ledger_of_account(p_account uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when kind = 'cash' then 'Cash in hand' else 'Bank — ' || name end
    from public.cash_accounts where id = p_account;
$$;

-- Money movements: Dr/Cr the bank (or cash) against the reason.
create or replace function public.post_cash_txn()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bank text; v_other text; v_narr text;
begin
  v_bank := public.ledger_of_account(new.account_id);
  v_other := case new.ref_type
    when 'payable'  then 'Accounts Payable'
    when 'expense'  then 'Expenses Payable'
    when 'advance'  then 'Advances Recoverable'
    when 'salary'   then 'Salaries Payable'
    when 'transfer' then 'Inter-account Transfer'
    else 'Suspense' end;
  v_narr := coalesce(new.note, new.ref_type, 'Cash movement');

  if new.direction = 'out' then
    insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
      values (new.txn_date, v_narr, v_other, new.amount, 0, 'cash_txn', new.id::text, new.created_by),
             (new.txn_date, v_narr, v_bank,  0, new.amount, 'cash_txn', new.id::text, new.created_by);
  else
    insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
      values (new.txn_date, v_narr, v_bank,  new.amount, 0, 'cash_txn', new.id::text, new.created_by),
             (new.txn_date, v_narr, v_other, 0, new.amount, 'cash_txn', new.id::text, new.created_by);
  end if;
  return new;
end $$;
drop trigger if exists cash_txn_journal on public.cash_txns;
create trigger cash_txn_journal after insert on public.cash_txns
  for each row execute function public.post_cash_txn();

-- Keep the journal honest when a movement is removed.
create or replace function public.unpost_cash_txn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounting_entries where ref_type='cash_txn' and ref_id = old.id::text;
  return old;
end $$;
drop trigger if exists cash_txn_unjournal on public.cash_txns;
create trigger cash_txn_unjournal after delete on public.cash_txns
  for each row execute function public.unpost_cash_txn();

-- Raising a supplier invoice creates the liability: Dr Purchases, Cr AP.
create or replace function public.post_payable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounting_entries where ref_type='payable' and ref_id = new.id::text;
  insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
    values (new.invoice_date, coalesce(new.vendor_invoice_no,'Supplier invoice'),
            coalesce(nullif(new.category,''),'Purchases'), new.total, 0, 'payable', new.id::text, new.created_by),
           (new.invoice_date, coalesce(new.vendor_invoice_no,'Supplier invoice'),
            'Accounts Payable', 0, new.total, 'payable', new.id::text, new.created_by);
  return new;
end $$;
drop trigger if exists payable_journal on public.payables;
create trigger payable_journal after insert or update of total, invoice_date, category on public.payables
  for each row execute function public.post_payable();

-- Recording an expense: Dr the category, Cr Expenses Payable (cleared when paid).
create or replace function public.post_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat text;
begin
  select name into v_cat from public.expense_categories where id = new.category_id;
  delete from public.accounting_entries where ref_type='expense' and ref_id = new.id::text;
  insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
    values (new.expense_date, coalesce(new.note,'Expense'), coalesce(v_cat,'Miscellaneous'),
            new.total, 0, 'expense', new.id::text, new.created_by),
           (new.expense_date, coalesce(new.note,'Expense'), 'Expenses Payable',
            0, new.total, 'expense', new.id::text, new.created_by);
  return new;
end $$;
drop trigger if exists expense_journal on public.expenses;
create trigger expense_journal after insert or update of total, expense_date, category_id on public.expenses
  for each row execute function public.post_expense();

-- Customer receipts: Dr Bank, Cr Accounts Receivable.
create or replace function public.post_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bank text;
begin
  if new.account_id is null then return new; end if;
  v_bank := public.ledger_of_account(new.account_id);
  delete from public.accounting_entries where ref_type='receipt' and ref_id = new.id::text;
  insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
    values (new.paid_on, coalesce(new.note,'Receipt'), v_bank, new.amount, 0, 'receipt', new.id::text, new.created_by),
           (new.paid_on, coalesce(new.note,'Receipt'), 'Accounts Receivable', 0, new.amount, 'receipt', new.id::text, new.created_by);
  return new;
end $$;
drop trigger if exists receipt_journal on public.payments;
create trigger receipt_journal after insert or update of amount, paid_on, account_id on public.payments
  for each row execute function public.post_receipt();

-- ------------------------------------------------------ TRIAL BALANCE ---
create or replace view public.v_trial_balance as
  select account,
         round(sum(debit),2)               as debit,
         round(sum(credit),2)              as credit,
         round(sum(debit) - sum(credit),2) as balance
    from public.accounting_entries
   group by account
  having round(sum(debit),2) <> 0 or round(sum(credit),2) <> 0
   order by account;
grant select on public.v_trial_balance to authenticated;
-- ============================================================================
-- 43. Stop a receipt slipping into a day that is already closed
-- ----------------------------------------------------------------------------
-- The closed-day guard was only on cash_txns. A collection (public.payments)
-- back-dated into a closed day therefore bypassed it: the day_close figures are
-- frozen and the next opening chains from that frozen actual, so the receipt
-- would be orphaned — in the journal but not in the reconciliation.
--
-- payments has no txn_date column, so it needs its own guard function that
-- keys on paid_on. It only fires when an account is set, so the historical
-- Tracker-import receipts (account_id null, invisible to the Day Book by design)
-- are unaffected.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

create or replace function public.guard_closed_day_payment()
returns trigger language plpgsql as $$
begin
  if new.account_id is not null
     and exists (select 1 from public.day_close
                  where account_id = new.account_id and close_date = new.paid_on) then
    raise exception
      'That day is closed for this account. An approver must reopen % before recording or changing a receipt on it.',
      new.paid_on;
  end if;
  return new;
end $$;

drop trigger if exists payments_closed_guard on public.payments;
create trigger payments_closed_guard before insert or update on public.payments
  for each row execute function public.guard_closed_day_payment();
-- ============================================================================
-- 44. Backstop against duplicate receipts / payments from a double-submit
-- ----------------------------------------------------------------------------
-- The UI now disables the button on click, but a network retry or a second
-- device can still fire the same insert twice. These triggers reject an
-- IDENTICAL row created within a short window (same key fields, same user,
-- within 30 seconds). A genuine second part-payment differs in amount, date or
-- reference, so it is unaffected; only an exact repeat is blocked.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- Receipts (public.payments): same invoice, amount, date, account, user.
create or replace function public.dedupe_payment()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.payments p
     where p.document_id = new.document_id
       and p.amount      = new.amount
       and p.paid_on     = new.paid_on
       and coalesce(p.account_id::text,'') = coalesce(new.account_id::text,'')
       and p.created_by  = new.created_by
       and p.created_at  > now() - interval '30 seconds'
  ) then
    raise exception 'This exact receipt was just recorded a moment ago. Check the list before entering it again.';
  end if;
  return new;
end $$;
drop trigger if exists payments_dedupe on public.payments;
create trigger payments_dedupe before insert on public.payments
  for each row execute function public.dedupe_payment();

-- Money movements (public.cash_txns): same account, direction, amount, date,
-- what-it-settles and user.
create or replace function public.dedupe_cash_txn()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.cash_txns c
     where c.account_id = new.account_id
       and c.direction  = new.direction
       and c.amount     = new.amount
       and c.txn_date   = new.txn_date
       and coalesce(c.ref_type,'') = coalesce(new.ref_type,'')
       and coalesce(c.ref_id,'')   = coalesce(new.ref_id,'')
       and c.created_by = new.created_by
       and c.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'This exact payment was just recorded a moment ago. Check before entering it again.';
  end if;
  return new;
end $$;
drop trigger if exists cash_txns_dedupe on public.cash_txns;
create trigger cash_txns_dedupe before insert on public.cash_txns
  for each row execute function public.dedupe_cash_txn();
-- ============================================================================
-- 45. Find and clean duplicate receipts (same invoice, date and amount)
-- ----------------------------------------------------------------------------
-- "Exactly same" = same invoice (so same client), same paid_on, same amount.
-- The plan keeps the EARLIEST copy of each group and removes the rest.
-- Backup-first and reversible. Run the steps IN ORDER; read each before moving on.
-- ============================================================================

-- Deleting a receipt must also remove its journal entry, else the trial balance
-- double-counts. There is an unpost trigger for cash movements but not for
-- receipts — add it now, so this cleanup and every future delete stay consistent.
create or replace function public.unpost_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounting_entries where ref_type='receipt' and ref_id = old.id::text;
  return old;
end $$;
drop trigger if exists receipt_unjournal on public.payments;
create trigger receipt_unjournal after delete on public.payments
  for each row execute function public.unpost_receipt();

-- ---------------------------------------------------------------------------
-- STEP 1 — REVIEW. Read this before deleting anything. One row per duplicate
--          group; 'copies' > 1 means duplicates exist. 'extra_ids' are the ones
--          that would be deleted (the earliest of each group is kept).
-- ---------------------------------------------------------------------------
with ranked as (
  select p.*,
         row_number() over (partition by p.document_id, p.paid_on, p.amount order by p.id) as rn
    from public.payments p
)
select r.document_id,
       d.number                                                   as invoice_no,
       coalesce(d.party_snapshot->>'firmName',
                d.party_snapshot->>'name')                        as client,
       r.paid_on,
       r.amount,
       count(*)                                                    as copies,
       (array_agg(r.id order by r.id))[1]                          as keep_id,
       array_agg(r.id order by r.id) filter (where r.rn > 1)       as extra_ids,
       array_agg(distinct coalesce(r.mode,'—'))                    as modes,
       min(r.created_at)                                           as first_entered,
       max(r.created_at)                                           as last_entered
  from ranked r
  join public.documents d on d.id = r.document_id
 group by r.document_id, d.number, client, r.paid_on, r.amount
having count(*) > 1
 order by r.paid_on desc, client;

-- If STEP 1 returns nothing, there are no exact duplicates — stop here.
-- NOTE: rows with mode 'Tracker import' are historical bulk imports, not team
-- entries. If any duplicate groups are Tracker imports you did NOT mean to
-- clean, tell me and I will narrow the delete.

-- ---------------------------------------------------------------------------
-- STEP 2 — BACKUP the rows that will be deleted (the extras only).
-- ---------------------------------------------------------------------------
create table if not exists public.payments_dupe_backup_20260725 as
  select p.* from public.payments p
   where p.id in (
     select id from (
       select id, row_number() over (partition by document_id, paid_on, amount order by id) rn
         from public.payments
     ) x where x.rn > 1
   );

-- confirm the count matches the total 'extra_ids' you saw in STEP 1
select count(*) as rows_to_delete from public.payments_dupe_backup_20260725;

-- ---------------------------------------------------------------------------
-- STEP 3 — DELETE the extras. The receipt_unjournal trigger removes their
--          journal entries automatically. Only run once STEP 1 + 2 look right.
-- ---------------------------------------------------------------------------
delete from public.payments
 where id in (select id from public.payments_dupe_backup_20260725);

-- ---------------------------------------------------------------------------
-- STEP 4 — VERIFY. Re-run STEP 1's query; it must now return 0 rows. And the
--          trial balance should still balance:
-- ---------------------------------------------------------------------------
select round(sum(debit),2) as total_debit, round(sum(credit),2) as total_credit,
       round(sum(debit)-sum(credit),2) as should_be_zero
  from public.accounting_entries;

-- ---------------------------------------------------------------------------
-- STEP 5 — UNDO (only if needed). Restores every deleted receipt; the journal
--          re-posts via the existing receipt_journal trigger.
-- ---------------------------------------------------------------------------
-- insert into public.payments
--   overriding system value
--   select * from public.payments_dupe_backup_20260725;

-- ---------------------------------------------------------------------------
-- STEP 6 — Drop the backup once you are satisfied. NOT reversible.
-- ---------------------------------------------------------------------------
-- drop table public.payments_dupe_backup_20260725;
-- ============================================================================
-- 46. Fix: creating a Location from the UI failed
-- ----------------------------------------------------------------------------
-- The Locations form sends created_by, but spray_locations never had that
-- column — so every "Create location" attempt failed with
--   "Could not find the 'created_by' column of 'spray_locations'".
-- It went unnoticed because locations used to be auto-created by
-- post_daily_submission(), which does not set created_by.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

alter table public.spray_locations
  add column if not exists created_by uuid references public.profiles(id);
