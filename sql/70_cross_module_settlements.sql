-- ============================================================================
-- 70. Cross-module settlements (contra netting) — engine
-- ----------------------------------------------------------------------------
-- Lets one open item be settled against another across modules, e.g. a client
-- receivable netted against a vendor payable, or an employee advance against
-- their expense/salary. A settlement moves NO cash — it posts a balanced contra
-- journal (Dr the payable-side control account, Cr the receivable-side control)
-- and reduces BOTH items' balances. Edited/deleted only from where it was
-- initiated (the row records initiated_from). Additive / idempotent.
--
-- Open-item types, their control account and side (receivable = owed TO us,
-- payable = owed BY us):
--   client_invoice  Accounts Receivable   receivable
--   advance         Advances Recoverable  receivable   (a recoverable advance)
--   vendor_payable  Accounts Payable      payable
--   expense_claim   Employee Expenses     payable
--   salary          Salaries Payable      payable
-- A valid settlement pairs ONE receivable-side item with ONE payable-side item.
-- ============================================================================

create table if not exists public.settlements (
  id            uuid primary key default gen_random_uuid(),
  settle_date   date not null default current_date,
  amount        numeric not null check (amount > 0),
  a_type        text not null,             -- item being recorded/paid (initiator)
  a_id          text not null,
  a_label       text,
  b_type        text not null,             -- item it is settled against
  b_id          text not null,
  b_label       text,
  note          text,
  initiated_from text,                      -- which sub-tab created it (for "edit here only")
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists settlements_a_idx on public.settlements(a_type, a_id);
create index if not exists settlements_b_idx on public.settlements(b_type, b_id);

alter table public.settlements enable row level security;
drop policy if exists settlements_rw on public.settlements;
create policy settlements_rw on public.settlements for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
grant select, insert, update, delete on public.settlements to authenticated;

-- control account + side for an open-item type
create or replace function public.settle_meta(p_type text)
returns table(account text, side text) language sql immutable as $$
  select account, side from (values
    ('client_invoice','Accounts Receivable','receivable'),
    ('advance',       'Advances Recoverable','receivable'),
    ('vendor_payable','Accounts Payable',   'payable'),
    ('expense_claim', 'Employee Expenses',  'payable'),
    ('salary',        'Salaries Payable',   'payable')
  ) v(t,account,side) where t = p_type;
$$;

-- total settled against a given item (as either side of a settlement)
create or replace function public.settled_amount(p_type text, p_id text)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(amount),0) from public.settlements
   where (a_type = p_type and a_id = p_id) or (b_type = p_type and b_id = p_id);
$$;
grant execute on function public.settle_meta(text) to authenticated;
grant execute on function public.settled_amount(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Unified OPEN ITEMS — everything that still has a balance, for the dropdown.
-- balance already nets payments/credits AND settlements.
-- ---------------------------------------------------------------------------
create or replace view public.v_open_items as
-- client invoices (receivable)
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
-- vendor payables (payable)
select 'vendor_payable', p.id::text, coalesce(p.vendor_invoice_no,'(no no.)'), 'payable',
       coalesce(v.firm_name, v.name,''), null, p.invoice_date,
       coalesce(p.total,0),
       round(coalesce(p.total,0)
         - coalesce((select sum(t.amount)+sum(coalesce(t.tds_amount,0)) from public.cash_txns t where t.ref_type='payable' and t.ref_id = p.id::text),0)
         - coalesce((select sum(pc.amount) from public.payable_credits pc where pc.payable_id = p.id),0)
         - public.settled_amount('vendor_payable', p.id::text), 2)
  from public.payables p left join public.vendors v on v.id = p.vendor_id
union all
-- employee expense claims (payable)
select 'expense_claim', e.id::text, coalesce(e.employee_name,'(claim)'), 'payable',
       coalesce(e.employee_name,''), null, e.created_at::date,
       coalesce(e.total,0),
       round(coalesce(e.total,0)
         - coalesce((select sum(t.amount)+sum(coalesce(t.tds_amount,0)) from public.cash_txns t where t.ref_type='expense_claim' and t.ref_id = e.id::text),0)
         - public.settled_amount('expense_claim', e.id::text), 2)
  from public.expense_claims e where e.status in ('approved','paid')
union all
-- recoverable advances (receivable)
select 'advance', a.id::text, coalesce(a.payee_text, a.purpose, 'advance'), 'receivable',
       coalesce(a.payee_text,''), null, a.issued_on,
       coalesce(a.amount,0),
       round(coalesce(a.amount,0)
         - coalesce((select sum(s.amount) from public.advance_settlements s where s.advance_id = a.id),0)
         - public.settled_amount('advance', a.id::text), 2)
  from public.advances a where a.status = 'open'
union all
-- unpaid salary runs (payable)
select 'salary', r.id::text, coalesce(r.period_month,'salary'), 'payable',
       '', null, null::date,
       coalesce(r.net_payable,0),
       round(coalesce(r.net_payable,0)
         - coalesce((select sum(ae.debit) from public.accounting_entries ae where ae.ref_type='salary_payment' and ae.ref_id = r.id::text),0)
         - public.settled_amount('salary', r.id::text), 2)
  from public.salary_runs r where r.status in ('posted','calculated');
grant select on public.v_open_items to authenticated;

-- open items with a real balance (what the dropdown shows)
create or replace view public.v_open_items_due as
  select * from public.v_open_items where balance > 0.01;
grant select on public.v_open_items_due to authenticated;

-- ---------------------------------------------------------------------------
-- Apply a settlement (post the balanced contra journal) and record it.
-- p_a_* is the initiator item; p_b_* the item it is settled against.
-- ---------------------------------------------------------------------------
create or replace function public.apply_settlement(
  p_a_type text, p_a_id text, p_a_label text,
  p_b_type text, p_b_id text, p_b_label text,
  p_amount numeric, p_date date, p_note text, p_initiated_from text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a_acct text; a_side text; b_acct text; b_side text; dr_acct text; cr_acct text; rid uuid;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  select account, side into a_acct, a_side from public.settle_meta(p_a_type);
  select account, side into b_acct, b_side from public.settle_meta(p_b_type);
  if a_acct is null or b_acct is null then raise exception 'Unknown item type'; end if;
  if a_side = b_side then
    raise exception 'A settlement must pair a receivable (owed to us) with a payable (owed by us).'; end if;

  -- reduce the payable-side (Dr its control) and the receivable-side (Cr its control)
  if a_side = 'payable' then dr_acct := a_acct; cr_acct := b_acct;
  else dr_acct := b_acct; cr_acct := a_acct; end if;

  insert into public.settlements(settle_date, amount, a_type, a_id, a_label, b_type, b_id, b_label, note, initiated_from, created_by)
    values (coalesce(p_date,current_date), p_amount, p_a_type, p_a_id, p_a_label, p_b_type, p_b_id, p_b_label, p_note, p_initiated_from, auth.uid())
    returning id into rid;

  insert into public.accounting_entries(voucher_date, narration, account, debit, credit, ref_type, ref_id, created_by)
    values (coalesce(p_date,current_date), 'Settlement: '||coalesce(p_a_label,'')||' ↔ '||coalesce(p_b_label,''), dr_acct, p_amount, 0, 'settlement', rid::text, auth.uid()),
           (coalesce(p_date,current_date), 'Settlement: '||coalesce(p_a_label,'')||' ↔ '||coalesce(p_b_label,''), cr_acct, 0, p_amount, 'settlement', rid::text, auth.uid());

  -- keep advance/payable/invoice status flags in step where they have one
  if p_a_type='advance'  or p_b_type='advance'  then update public.advances set status='settled'
     where id::text = (case when p_a_type='advance' then p_a_id else p_b_id end)
       and (select balance from public.v_open_items where type='advance' and item_id = (case when p_a_type='advance' then p_a_id else p_b_id end)) <= 0.01; end if;
  return rid;
end $$;
grant execute on function public.apply_settlement(text,text,text,text,text,text,numeric,date,text,text) to authenticated;

-- delete a settlement (reverse the journal, restore both balances)
create or replace function public.delete_settlement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.settlements%rowtype;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select * into s from public.settlements where id = p_id;
  if s.id is null then raise exception 'Settlement not found'; end if;
  delete from public.accounting_entries where ref_type='settlement' and ref_id = p_id::text;
  if s.a_type='advance' then update public.advances set status='open' where id::text = s.a_id; end if;
  if s.b_type='advance' then update public.advances set status='open' where id::text = s.b_id; end if;
  delete from public.settlements where id = p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note) values (auth.uid(),'settlement_deleted','settlements',p_id::text,null);
end $$;
grant execute on function public.delete_settlement(uuid) to authenticated;
