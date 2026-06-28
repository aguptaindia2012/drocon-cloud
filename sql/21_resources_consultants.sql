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
