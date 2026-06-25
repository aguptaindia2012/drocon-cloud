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
create unique index if not exists documents_number_uniq on public.documents(doc_type, number);

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
