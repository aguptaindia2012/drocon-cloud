-- ============================================================================
-- 61. TDS on settlements (client receipts + vendor payments)
-- ----------------------------------------------------------------------------
-- A receipt/payment can carry a TDS deduction. The invoice/bill is settled by
-- (cash + TDS); only the cash actually moves through the bank.
--   Client receipt:  Dr Bank (cash) · Dr TDS Receivable (tds) · Cr A/Receivable (gross)
--   Vendor payment:  Dr A/Payable (gross) · Cr Bank (cash) · Cr TDS Payable (tds)
-- Settlement views therefore count paid = cash amount + tds_amount.
-- Additive: two nullable columns + trigger/view refreshes. Old rows tds=0.
-- ============================================================================

alter table public.payments  add column if not exists tds_pct    numeric;
alter table public.payments  add column if not exists tds_amount numeric not null default 0;
alter table public.cash_txns add column if not exists tds_pct    numeric;
alter table public.cash_txns add column if not exists tds_amount numeric not null default 0;

-- ---- Customer receipts: Dr Bank (cash) + Dr TDS Receivable, Cr A/Receivable (gross)
create or replace function public.post_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bank text; v_tds numeric;
begin
  if new.account_id is null then return new; end if;
  v_bank := public.ledger_of_account(new.account_id);
  v_tds  := coalesce(new.tds_amount,0);
  delete from public.accounting_entries where ref_type='receipt' and ref_id = new.id::text;
  insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
    values (new.paid_on, coalesce(new.note,'Receipt'), v_bank, new.amount, 0, 'receipt', new.id::text, new.created_by),
           (new.paid_on, coalesce(new.note,'Receipt'), 'Accounts Receivable', 0, new.amount + v_tds, 'receipt', new.id::text, new.created_by);
  if v_tds > 0 then
    insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
      values (new.paid_on, 'TDS deducted by client', 'TDS Receivable', v_tds, 0, 'receipt', new.id::text, new.created_by);
  end if;
  return new;
end $$;
drop trigger if exists receipt_journal on public.payments;
create trigger receipt_journal after insert or update of amount, paid_on, account_id, tds_amount on public.payments
  for each row execute function public.post_receipt();

-- ---- Cash movements: money OUT with TDS withheld
create or replace function public.post_cash_txn()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bank text; v_other text; v_narr text; v_tds numeric;
begin
  v_bank := public.ledger_of_account(new.account_id);
  v_other := case new.ref_type
    when 'payable'  then 'Accounts Payable'
    when 'expense'  then 'Expenses Payable'
    when 'advance'  then 'Advances Recoverable'
    when 'salary'   then 'Salaries Payable'
    when 'transfer' then 'Inter-account Transfer'
    else 'Suspense' end;
  v_narr := coalesce(new.note, new.ref_type, 'Cash movement');
  v_tds  := coalesce(new.tds_amount,0);
  if new.direction = 'out' then
    insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
      values (new.txn_date, v_narr, v_other, new.amount + v_tds, 0, 'cash_txn', new.id::text, new.created_by),
             (new.txn_date, v_narr, v_bank,  0, new.amount, 'cash_txn', new.id::text, new.created_by);
    if v_tds > 0 then
      insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
        values (new.txn_date, 'TDS withheld', 'TDS Payable', 0, v_tds, 'cash_txn', new.id::text, new.created_by);
    end if;
  else
    insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
      values (new.txn_date, v_narr, v_bank,  new.amount, 0, 'cash_txn', new.id::text, new.created_by),
             (new.txn_date, v_narr, v_other, 0, new.amount, 'cash_txn', new.id::text, new.created_by);
  end if;
  return new;
end $$;
drop trigger if exists cash_txn_journal on public.cash_txns;
create trigger cash_txn_journal after insert on public.cash_txns
  for each row execute function public.post_cash_txn();

-- ---- Settlement views now count paid = cash + TDS -------------------------
create or replace view public.v_acre_payment as
with doc_paid as (
  select d.id,
         coalesce((d.totals->>'total')::numeric, 0) as total,
         coalesce((select sum(p.amount + coalesce(p.tds_amount,0)) from public.payments p where p.document_id = d.id), 0) as paid
    from public.documents d
)
select a.id                        as acre_id,
       a.entry_date, a.location_id, a.acres, a.pilot_id, a.pilot_name,
       a.farmer_doc_id, fd.number  as farmer_doc_no,
       fp.total as farmer_total, fp.paid as farmer_paid,
       case when a.farmer_billed_override                     then 'written-off'
            when a.farmer_doc_id is null                      then 'unbilled'
            when fp.paid >= fp.total - 0.01 and fp.total > 0   then 'paid'
            when fp.paid > 0                                   then 'partial'
            else 'unpaid' end      as farmer_status,
       a.client_doc_id, cd.number  as client_doc_no,
       cp.total as client_total, cp.paid as client_paid,
       case when a.client_billed_override                     then 'written-off'
            when a.client_doc_id is null                      then 'unbilled'
            when cp.paid >= cp.total - 0.01 and cp.total > 0   then 'paid'
            when cp.paid > 0                                   then 'partial'
            else 'unpaid' end      as client_status
  from public.acre_entries a
  left join public.documents fd on fd.id = a.farmer_doc_id
  left join doc_paid        fp on fp.id  = a.farmer_doc_id
  left join public.documents cd on cd.id = a.client_doc_id
  left join doc_paid        cp on cp.id  = a.client_doc_id;
grant select on public.v_acre_payment to authenticated;

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
                        where pc.payable_id = p.id), 0) as balance
    from public.payables p
    left join public.vendors v on v.id = p.vendor_id
   where p.status <> 'paid';
grant select on public.v_payables_open to authenticated;
