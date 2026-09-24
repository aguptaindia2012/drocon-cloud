-- ============================================================================
-- 112. Consultants — rate basis, POC logins, and self-service expense claims
-- ----------------------------------------------------------------------------
--  • employees.rate_type : Monthly | Hourly | Daily  (consultant rate basis)
--  • consultant_pocs      : extra portal logins per consultant (like vendor_pocs)
--  • expense_claims insert: allow a portal user to file their OWN claim so
--    consultants can submit expenses (approval/payment stays internal).
-- ============================================================================
alter table public.employees add column if not exists rate_type text;   -- Monthly | Hourly | Daily

-- Extra portal logins for one consultant (consultant = employees row, emp_type='consultant')
create table if not exists public.consultant_pocs (
  consultant_id uuid not null references public.employees(id) on delete cascade,
  email         text not null,
  name          text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  primary key (consultant_id, email)
);
create unique index if not exists consultant_pocs_email_uidx on public.consultant_pocs(lower(email));
alter table public.consultant_pocs enable row level security;
drop policy if exists consultant_pocs_internal on public.consultant_pocs;
create policy consultant_pocs_internal on public.consultant_pocs for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
grant select, insert, update, delete on public.consultant_pocs to authenticated;

-- Let a portal user (e.g. a consultant) file their own expense claim.
-- Internal users keep full access; approval and payment remain internal-only.
drop policy if exists expense_claims_insert on public.expense_claims;
create policy expense_claims_insert on public.expense_claims for insert to authenticated
  with check ( public.is_internal() or created_by = auth.uid() );
