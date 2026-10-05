-- ============================================================================
-- 120. Position dashboard — net cross-module settlements
-- ----------------------------------------------------------------------------
-- When a vendor payable is settled against a client invoice / advance (a no-cash
-- contra via public.apply_settlement), the settled amount was being subtracted
-- everywhere EXCEPT the live Position dashboard, which reads v_payables_open and
-- v_receivables_open. Those two views counted only real cash + credit notes, so
-- a fully contra-settled invoice/bill kept showing as outstanding there even
-- though it read "settled" elsewhere.
--
-- Fix: make both views net public.settled_amount(...) exactly like v_open_items
-- already does. (v_advances_open was already fixed in sql/74.)
--   * v_payables_open     : subtract settled_amount('vendor_payable', id)
--   * v_receivables_open  : subtract settled_amount('client_invoice', id)
--
-- Also align v_receivables_open's cash math with v_open_items / post_receipt:
-- a receipt credits Accounts Receivable by (cash + TDS), so "received" must
-- count TDS too — otherwise a TDS-bearing receipt left a phantom balance.
--
-- Note: `create or replace view` can only APPEND columns, so the new `settled`
-- column goes at the end of each column list (existing order is preserved).
-- Additive / idempotent: view redefinitions only, no data touched.
-- ============================================================================

-- ---- Payables position: also net cross-module contra settlements ----------
create or replace view public.v_payables_open as
  select p.*, coalesce(v.firm_name, v.name) as vendor_name,
         coalesce((select sum(c.amount + coalesce(c.tds_amount,0)) from public.cash_txns c
                    where c.ref_type='payable' and c.ref_id = p.id::text), 0) as paid,
         coalesce((select sum(pc.amount) from public.payable_credits pc
                    where pc.payable_id = p.id), 0) as credited,
         p.total
           - coalesce((select sum(c.amount + coalesce(c.tds_amount,0)) from public.cash_txns c
                        where c.ref_type='payable' and c.ref_id = p.id::text), 0)
           - coalesce((select sum(pc.amount) from public.payable_credits pc
                        where pc.payable_id = p.id), 0)
           - public.settled_amount('vendor_payable', p.id::text) as balance,
         public.settled_amount('vendor_payable', p.id::text) as settled
    from public.payables p
    left join public.vendors v on v.id = p.vendor_id
   where p.status <> 'paid';
grant select on public.v_payables_open to authenticated;

-- ---- Receivables position: net contra settlements + count TDS in receipts --
create or replace view public.v_receivables_open as
  select d.id, d.number, d.doc_date, d.entity,
         coalesce((d.party_snapshot->>'firmName'), (d.party_snapshot->>'name')) as party_name,
         coalesce((d.totals->>'total')::numeric, 0) as invoiced,
         coalesce((select sum(p.amount + coalesce(p.tds_amount,0)) from public.payments p
                    where p.document_id = d.id), 0) as received,
         coalesce((select sum(coalesce((c.totals->>'total')::numeric,0)) from public.documents c
                    where c.doc_type='credit_note' and c.related_doc_id = d.id), 0) as credited,
         coalesce((d.totals->>'total')::numeric, 0)
           - coalesce((select sum(p.amount + coalesce(p.tds_amount,0)) from public.payments p
                        where p.document_id = d.id), 0)
           - coalesce((select sum(coalesce((c.totals->>'total')::numeric,0)) from public.documents c
                        where c.doc_type='credit_note' and c.related_doc_id = d.id), 0)
           - public.settled_amount('client_invoice', d.id::text) as balance,
         greatest(0, current_date - d.doc_date) as age_days,
         public.settled_amount('client_invoice', d.id::text) as settled
    from public.documents d
   where d.doc_type = 'invoice';
grant select on public.v_receivables_open to authenticated;
