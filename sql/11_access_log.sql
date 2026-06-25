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
