-- ============================================================================
-- 83. Mail accounts — encrypted per-user Hostinger IMAP/SMTP credentials
-- ----------------------------------------------------------------------------
-- Backing store for the in-app email client. Each internal user connects THEIR
-- OWN mailbox once; the mail backend encrypts the password (AES-256-GCM) with a
-- server-side key and writes it here. The browser NEVER reads this table:
--   - RLS is on with NO policies for authenticated  => default deny to clients.
--   - Only the backend (Supabase service_role) reads/writes it.
-- The app learns "am I connected?" by calling the backend /mail/status, not by
-- reading this table. Additive & idempotent.
-- ============================================================================

create table if not exists public.mail_accounts (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  email       text not null,
  imap_host   text not null,
  imap_port   int  not null default 993,
  smtp_host   text not null,
  smtp_port   int  not null default 465,
  enc         text not null,               -- base64(iv|tag|ciphertext) of the password
  status      text not null default 'connected',   -- connected | error
  last_error  text,
  updated_at  timestamptz not null default now()
);

alter table public.mail_accounts enable row level security;
-- (intentionally NO policies -> authenticated clients cannot see or change rows;
--  the backend uses the service_role key which bypasses RLS.)
revoke all on public.mail_accounts from anon, authenticated;
