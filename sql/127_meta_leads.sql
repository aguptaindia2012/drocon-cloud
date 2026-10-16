-- ============================================================================
-- 127. Meta (Facebook/Instagram) Lead Ads — inbox + config
-- ----------------------------------------------------------------------------
-- Lead-Ad submissions do NOT auto-merge into the tracker. They land in a staging
-- INBOX (meta_leads_inbox). The BD team reviews each one and clicks "Transfer to
-- DCB lead tracker", which creates the real public.leads row (prefilled) and
-- marks the inbox item transferred. Keeps raw Meta data separate from the
-- working pipeline. Additive / idempotent.
-- ============================================================================
create table if not exists public.meta_leads_inbox (
  id            uuid primary key default gen_random_uuid(),
  meta_lead_id  text unique,                 -- Meta's leadgen_id (dedupe)
  meta_form_id  text,
  meta_page_id  text,
  name          text,
  phone         text,
  email         text,
  city          text,
  interest      text,
  raw           jsonb,
  status        text not null default 'new', -- new | transferred | dismissed
  transferred_lead_id uuid references public.leads(id),
  received_at   timestamptz not null default now(),
  handled_by    uuid references public.profiles(id),
  handled_at    timestamptz
);
create index if not exists mli_status_idx on public.meta_leads_inbox(status, received_at desc);

alter table public.meta_leads_inbox enable row level security;
drop policy if exists mli_read on public.meta_leads_inbox;
create policy mli_read   on public.meta_leads_inbox for select to authenticated using (public.is_internal());
drop policy if exists mli_update on public.meta_leads_inbox;
create policy mli_update on public.meta_leads_inbox for update to authenticated using (public.is_internal());
-- inserts come from the webhook via the service-role key (bypasses RLS); deletes admin-only
drop policy if exists mli_delete on public.meta_leads_inbox;
create policy mli_delete on public.meta_leads_inbox for delete to authenticated using (public.has_role(array['admin']::user_role[]));
grant select, update, delete on public.meta_leads_inbox to authenticated;

create table if not exists public.meta_lead_config (
  id            int primary key default 1,
  enabled       boolean not null default true,
  default_owner uuid references public.profiles(id),
  source_label  text not null default 'facebook',
  last_event_at timestamptz,
  last_lead_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint meta_lead_config_singleton check (id = 1)
);
insert into public.meta_lead_config(id) values (1) on conflict (id) do nothing;
alter table public.meta_lead_config enable row level security;
drop policy if exists mlc_read on public.meta_lead_config;
create policy mlc_read  on public.meta_lead_config for select to authenticated using (public.is_internal());
drop policy if exists mlc_write on public.meta_lead_config;
create policy mlc_write on public.meta_lead_config for update to authenticated using (public.has_role(array['admin']::user_role[]));
grant select, update on public.meta_lead_config to authenticated;
