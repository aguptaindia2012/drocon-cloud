-- ============================================================================
-- 103. Vendor POCs — multiple portal logins per vendor (like client POCs)
-- ----------------------------------------------------------------------------
-- Authorise several email logins for one vendor; each is created with
-- party_id = vendors.id, so they share the vendor's portal (pilots, acre review,
-- invoicing, etc.). Managed from the Vendors register.
-- ============================================================================
create table if not exists public.vendor_pocs (
  vendor_id  uuid not null references public.vendors(id) on delete cascade,
  email      text not null,
  name       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (vendor_id, email)
);
create unique index if not exists vendor_pocs_email_uidx on public.vendor_pocs(lower(email));
alter table public.vendor_pocs enable row level security;
drop policy if exists vendor_pocs_internal on public.vendor_pocs;
create policy vendor_pocs_internal on public.vendor_pocs for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
grant select, insert, update, delete on public.vendor_pocs to authenticated;
