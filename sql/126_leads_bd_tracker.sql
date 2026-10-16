-- ============================================================================
-- 126. Leads / BD Tracker
-- ----------------------------------------------------------------------------
-- Capture product-purchase leads from any source (WhatsApp, phone, Facebook,
-- Instagram, referral, walk-in, website, …), track follow-ups, and drive a
-- reminder dashboard off next_follow_up. Deliberately low-friction: NOTHING is
-- mandatory, so a lead (or a follow-up note) can always be saved.
-- Additive / idempotent.
-- ============================================================================
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  name           text,
  phone          text,
  source         text,                 -- whatsapp | phone | facebook | instagram | referral | walk_in | website | other
  interest       text,                 -- what they want (free text)
  city           text,
  est_value      numeric,
  status         text not null default 'new',   -- new|contacted|interested|quoted|won|lost|on_hold
  owner          uuid references public.profiles(id),
  next_follow_up date,
  last_contacted date,
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_nextfu_idx on public.leads(next_follow_up);
create index if not exists leads_owner_idx  on public.leads(owner);

-- the follow-up / activity log for a lead
create table if not exists public.lead_followups (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  note           text,
  next_follow_up date,
  status         text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists lead_fu_lead_idx on public.lead_followups(lead_id, created_at desc);

-- RLS: internal team read/write; delete by creator or admin (mirrors registers)
do $$ declare t text;
begin
  foreach t in array array['leads','lead_followups'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (public.is_internal());', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.is_internal());', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.is_internal());', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.has_role(array[''admin'']::user_role[]) or created_by = auth.uid());', t, t);
  end loop;
end $$;
grant select, insert, update, delete on public.leads, public.lead_followups to authenticated;
