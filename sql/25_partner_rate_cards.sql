-- ============================================================================
-- DroCon Cloud — Per-partner Authorized-Partner rate cards
-- The commission slabs become a per-partner rate card: each authorized partner
-- can carry their own slabs. Rows with partner_id IS NULL remain the STANDARD
-- (default) card used as a fallback when a partner has no custom card.
-- A partner (external login) may read only their OWN card + the standard one.
-- Safe to re-run.
-- ============================================================================

alter table public.partner_rates
  add column if not exists partner_id uuid references public.authorized_partners(id) on delete cascade;
create index if not exists partner_rates_partner on public.partner_rates(partner_id);

-- Tighten read: internal users see all; an external partner sees only the
-- standard card (partner_id null) plus their own (partner_id = their party_id).
drop policy if exists partner_rates_read on public.partner_rates;
create policy partner_rates_read on public.partner_rates for select to authenticated
  using (
    public.is_internal()
    or partner_id is null
    or partner_id = (select p.party_id from public.profiles p where p.id = auth.uid())
  );
-- write stays admin-only (unchanged)
drop policy if exists partner_rates_write on public.partner_rates;
create policy partner_rates_write on public.partner_rates for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));

-- ============================================================================
-- Done. Manage cards in Partners → Authorized Partner: pick a partner (or the
-- Standard card), edit their slabs, save. Invoices resolve commission from the
-- partner's own card, falling back to the Standard card.
-- ============================================================================
