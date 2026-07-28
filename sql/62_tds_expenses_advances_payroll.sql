-- ============================================================================
-- 62. Extend the settle/TDS workflow to expenses, advances and payroll
-- ----------------------------------------------------------------------------
-- * salary_payments gains TDS columns (payroll can withhold TDS).
-- * expense_claims can be part-paid; their payments flow through cash_txns
--   (ref_type='expense_claim') so they hit the Day Book and carry TDS like any
--   other money-out — post_cash_txn now maps that ref to "Employee Expenses".
-- Additive.
-- ============================================================================

alter table public.salary_payments add column if not exists tds_pct    numeric;
alter table public.salary_payments add column if not exists tds_amount numeric not null default 0;

-- allow a partially-paid expense claim
alter table public.expense_claims drop constraint if exists expense_claims_status_check;
alter table public.expense_claims add constraint expense_claims_status_check
  check (status in ('draft','submitted','approved','rejected','part_paid','paid'));

-- cash_txns can now settle an employee expense claim (Dr Employee Expenses)
create or replace function public.post_cash_txn()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bank text; v_other text; v_narr text; v_tds numeric;
begin
  v_bank := public.ledger_of_account(new.account_id);
  v_other := case new.ref_type
    when 'payable'       then 'Accounts Payable'
    when 'expense'       then 'Expenses Payable'
    when 'expense_claim' then 'Employee Expenses'
    when 'advance'       then 'Advances Recoverable'
    when 'salary'        then 'Salaries Payable'
    when 'transfer'      then 'Inter-account Transfer'
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
