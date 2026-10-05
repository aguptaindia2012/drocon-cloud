-- ============================================================================
-- 121. Re-assert v_open_items (guarantee expense + advance branches)
-- ----------------------------------------------------------------------------
-- The Payments & Settlements hub reads v_open_items. Expenses (the `expenses`
-- table) only entered this view in sql/74; if that migration was skipped or an
-- older definition is live, expenses never appear on the hub. This recreates the
-- canonical definition (client invoices, vendor bills, expenses, employee
-- claims, advances, salary runs) so every open item shows. Idempotent.
-- ============================================================================
create or replace view public.v_open_items as
select 'client_invoice'::text as type, d.id::text as item_id,
       coalesce(d.number,'(inv)') as ref, 'receivable'::text as side,
       coalesce((d.party_snapshot->>'firmName'), (d.party_snapshot->>'name'),'') as party,
       d.entity, d.doc_date as item_date,
       coalesce((d.totals->>'total')::numeric,0) as gross,
       round(coalesce((d.totals->>'total')::numeric,0)
         - coalesce((select sum(p.amount)+sum(coalesce(p.tds_amount,0)) from public.payments p where p.document_id = d.id),0)
         - coalesce((select sum((c.totals->>'total')::numeric) from public.documents c where c.doc_type='credit_note' and c.related_doc_id = d.id),0)
         - public.settled_amount('client_invoice', d.id::text), 2) as balance
  from public.documents d where d.doc_type = 'invoice'
union all
select 'vendor_payable', p.id::text, coalesce(p.vendor_invoice_no,'(no no.)'), 'payable',
       coalesce(v.firm_name, v.name,''), null, p.invoice_date,
       coalesce(p.total,0),
       round(coalesce(p.total,0)
         - coalesce((select sum(t.amount)+sum(coalesce(t.tds_amount,0)) from public.cash_txns t where t.ref_type='payable' and t.ref_id = p.id::text),0)
         - coalesce((select sum(pc.amount) from public.payable_credits pc where pc.payable_id = p.id),0)
         - public.settled_amount('vendor_payable', p.id::text), 2)
  from public.payables p left join public.vendors v on v.id = p.vendor_id
union all
select 'expense', e.id::text, coalesce(nullif(e.bill_no,''), e.note, 'expense'), 'payable',
       coalesce(e.payee_text,''), null, e.expense_date,
       coalesce(e.total,0),
       round(coalesce(e.total,0)
         - coalesce((select sum(t.amount)+sum(coalesce(t.tds_amount,0)) from public.cash_txns t where t.ref_type='expense' and t.ref_id = e.id::text),0)
         - public.settled_amount('expense', e.id::text), 2)
  from public.expenses e where coalesce(e.status,'unpaid') <> 'paid'
union all
select 'expense_claim', e.id::text, coalesce(e.employee_name,'(claim)'), 'payable',
       coalesce(e.employee_name,''), null, e.created_at::date,
       coalesce(e.total,0),
       round(coalesce(e.total,0)
         - coalesce((select sum(t.amount)+sum(coalesce(t.tds_amount,0)) from public.cash_txns t where t.ref_type='expense_claim' and t.ref_id = e.id::text),0)
         - public.settled_amount('expense_claim', e.id::text), 2)
  from public.expense_claims e where e.status in ('approved','paid')
union all
select 'advance', a.id::text, coalesce(a.payee_text, a.purpose, 'advance'), 'receivable',
       coalesce(a.payee_text,''), null, a.issued_on,
       coalesce(a.amount,0),
       round(coalesce(a.amount,0)
         - coalesce((select sum(s.amount) from public.advance_settlements s where s.advance_id = a.id),0)
         - public.settled_amount('advance', a.id::text), 2)
  from public.advances a where a.status = 'open'
union all
select 'salary', r.id::text, coalesce(r.period_month,'salary'), 'payable',
       '', null, null::date,
       coalesce(r.net_payable,0),
       round(coalesce(r.net_payable,0)
         - coalesce((select sum(ae.debit) from public.accounting_entries ae where ae.ref_type='salary_payment' and ae.ref_id = r.id::text),0)
         - public.settled_amount('salary', r.id::text), 2)
  from public.salary_runs r where r.status in ('posted','calculated');
grant select on public.v_open_items to authenticated;
