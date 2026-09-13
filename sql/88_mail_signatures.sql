-- ============================================================================
-- 88. Email signatures (per user, multiple)
-- ----------------------------------------------------------------------------
-- Stores each user's email signatures so they follow them across devices.
-- Read/written directly by the app (RLS: each user only sees their own).
-- Additive & idempotent.
-- ============================================================================
create table if not exists public.mail_signatures (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name       text not null,
  body       text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mail_sig_user_idx on public.mail_signatures(user_id);

alter table public.mail_signatures enable row level security;
drop policy if exists mail_sig_all on public.mail_signatures;
create policy mail_sig_all on public.mail_signatures for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.mail_signatures to authenticated;
