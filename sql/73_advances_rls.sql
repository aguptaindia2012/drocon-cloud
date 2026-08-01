-- ============================================================================
-- 73. Fix: "new row violates row-level security policy for table advances"
-- ----------------------------------------------------------------------------
-- The advances table (and advance_settlements) had RLS enabled but no policy,
-- so every insert/update was denied. Add internal-only read/write policies,
-- matching the rest of the finance tables. Additive / idempotent.
-- ============================================================================

alter table public.advances enable row level security;
drop policy if exists advances_rw on public.advances;
create policy advances_rw on public.advances for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
grant select, insert, update, delete on public.advances to authenticated;

alter table public.advance_settlements enable row level security;
drop policy if exists advance_settlements_rw on public.advance_settlements;
create policy advance_settlements_rw on public.advance_settlements for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
grant select, insert, update, delete on public.advance_settlements to authenticated;
