-- ============================================================================
-- 42. Accounting Phase D — journal posting + "reconcile from" date
-- ----------------------------------------------------------------------------
-- (a) reconcile_from: stops the unclosed-days flag lighting up for every
--     historic receipt that predates the Day Book.
-- (b) Every money movement now posts double-entry into the existing
--     accounting_entries journal, giving a real trial balance. Doing this now,
--     while there is almost no data, avoids a painful retrofit later.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- --------------------------------------------------- (a) RECONCILE FROM --
alter table public.cash_accounts add column if not exists reconcile_from date;
update public.cash_accounts set reconcile_from = opened_on where reconcile_from is null;

-- only flag unclosed days on/after the account's reconcile_from date
create or replace view public.v_days_unclosed as
  select s.account_id, a.name as account_name, s.day
    from (
      select account_id, txn_date as day from public.cash_txns
      union
      select account_id, paid_on  as day from public.payments where account_id is not null
    ) s
    join public.cash_accounts a on a.id = s.account_id
   where s.day >= coalesce(a.reconcile_from, a.opened_on)
     and not exists (select 1 from public.day_close d
                      where d.account_id = s.account_id and d.close_date = s.day)
   group by s.account_id, a.name, s.day;
grant select on public.v_days_unclosed to authenticated;

-- ------------------------------------------------------- (b) JOURNAL ----
-- Ledger name for an account row.
create or replace function public.ledger_of_account(p_account uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when kind = 'cash' then 'Cash in hand' else 'Bank — ' || name end
    from public.cash_accounts where id = p_account;
$$;

-- Money movements: Dr/Cr the bank (or cash) against the reason.
create or replace function public.post_cash_txn()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bank text; v_other text; v_narr text;
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

  if new.direction = 'out' then
    insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
      values (new.txn_date, v_narr, v_other, new.amount, 0, 'cash_txn', new.id::text, new.created_by),
             (new.txn_date, v_narr, v_bank,  0, new.amount, 'cash_txn', new.id::text, new.created_by);
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

-- Keep the journal honest when a movement is removed.
create or replace function public.unpost_cash_txn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounting_entries where ref_type='cash_txn' and ref_id = old.id::text;
  return old;
end $$;
drop trigger if exists cash_txn_unjournal on public.cash_txns;
create trigger cash_txn_unjournal after delete on public.cash_txns
  for each row execute function public.unpost_cash_txn();

-- Raising a supplier invoice creates the liability: Dr Purchases, Cr AP.
create or replace function public.post_payable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounting_entries where ref_type='payable' and ref_id = new.id::text;
  insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
    values (new.invoice_date, coalesce(new.vendor_invoice_no,'Supplier invoice'),
            coalesce(nullif(new.category,''),'Purchases'), new.total, 0, 'payable', new.id::text, new.created_by),
           (new.invoice_date, coalesce(new.vendor_invoice_no,'Supplier invoice'),
            'Accounts Payable', 0, new.total, 'payable', new.id::text, new.created_by);
  return new;
end $$;
drop trigger if exists payable_journal on public.payables;
create trigger payable_journal after insert or update of total, invoice_date, category on public.payables
  for each row execute function public.post_payable();

-- Recording an expense: Dr the category, Cr Expenses Payable (cleared when paid).
create or replace function public.post_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat text;
begin
  select name into v_cat from public.expense_categories where id = new.category_id;
  delete from public.accounting_entries where ref_type='expense' and ref_id = new.id::text;
  insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
    values (new.expense_date, coalesce(new.note,'Expense'), coalesce(v_cat,'Miscellaneous'),
            new.total, 0, 'expense', new.id::text, new.created_by),
           (new.expense_date, coalesce(new.note,'Expense'), 'Expenses Payable',
            0, new.total, 'expense', new.id::text, new.created_by);
  return new;
end $$;
drop trigger if exists expense_journal on public.expenses;
create trigger expense_journal after insert or update of total, expense_date, category_id on public.expenses
  for each row execute function public.post_expense();

-- Customer receipts: Dr Bank, Cr Accounts Receivable.
create or replace function public.post_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bank text;
begin
  if new.account_id is null then return new; end if;
  v_bank := public.ledger_of_account(new.account_id);
  delete from public.accounting_entries where ref_type='receipt' and ref_id = new.id::text;
  insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
    values (new.paid_on, coalesce(new.note,'Receipt'), v_bank, new.amount, 0, 'receipt', new.id::text, new.created_by),
           (new.paid_on, coalesce(new.note,'Receipt'), 'Accounts Receivable', 0, new.amount, 'receipt', new.id::text, new.created_by);
  return new;
end $$;
drop trigger if exists receipt_journal on public.payments;
create trigger receipt_journal after insert or update of amount, paid_on, account_id on public.payments
  for each row execute function public.post_receipt();

-- ------------------------------------------------------ TRIAL BALANCE ---
create or replace view public.v_trial_balance as
  select account,
         round(sum(debit),2)               as debit,
         round(sum(credit),2)              as credit,
         round(sum(debit) - sum(credit),2) as balance
    from public.accounting_entries
   group by account
  having round(sum(debit),2) <> 0 or round(sum(credit),2) <> 0
   order by account;
grant select on public.v_trial_balance to authenticated;
