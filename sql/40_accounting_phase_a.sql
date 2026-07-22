-- ============================================================================
-- 40. Finance & Accounting — Phase A
--     Accounts, supplier invoices (payables), expenses, money movements and the
--     daily close. See ACCOUNTING_PLAN.md for the agreed design.
-- ----------------------------------------------------------------------------
-- Rules baked in:
--   • "Paid" means the day the money left the account (a cheque handed over is
--     'cheque_issued' and does NOT hit the day book).
--   • Cash in hand is a separate account with its own daily close.
--   • Opening balance is never typed — it chains from the previous actual close.
--   • Only an approver may close or reopen a day; both are audit-logged.
--   • A day may be closed with a difference, but the note is mandatory and it
--     is flagged.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- ----------------------------------------------------------- ACCOUNTS -----
create table if not exists public.cash_accounts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  kind              text not null check (kind in ('bank','cash')),
  bank_name         text,
  account_no_masked text,
  opening_balance   numeric not null default 0,
  opened_on         date not null default current_date,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- seed the two accounts (idempotent)
insert into public.cash_accounts (name, kind, bank_name, opening_balance, opened_on)
select 'DCB Bank', 'bank', 'DroCon Bharat Pvt Ltd', 101524.72, current_date
 where not exists (select 1 from public.cash_accounts where kind='bank');
insert into public.cash_accounts (name, kind, opening_balance, opened_on)
select 'Cash in hand', 'cash', 0, current_date
 where not exists (select 1 from public.cash_accounts where kind='cash');

-- --------------------------------------------- SUPPLIER INVOICES ---------
create table if not exists public.payables (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid references public.vendors(id),
  vendor_invoice_no text,
  invoice_date      date not null default current_date,
  due_date          date,
  amount            numeric not null default 0,
  gst_amount        numeric not null default 0,
  total             numeric not null default 0,
  category          text,
  note              text,
  status            text not null default 'unpaid'
                    check (status in ('unpaid','cheque_issued','part_paid','paid')),
  approval_status   text not null default 'approved',
  assigned_approver uuid references public.profiles(id),
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);
create index if not exists payables_vendor_idx on public.payables(vendor_id);
create index if not exists payables_status_idx on public.payables(status);

-- ------------------------------------------------------- EXPENSES --------
create table if not exists public.expense_categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  is_active boolean not null default true
);
insert into public.expense_categories (name)
select x from unnest(array['Travel','Fuel','Accommodation','Food & M&IE','Repairs & Maintenance',
                           'Spares','Office','Telephone & Internet','Professional Fees',
                           'Bank Charges','Freight','Miscellaneous']) x
 where not exists (select 1 from public.expense_categories);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category_id  uuid references public.expense_categories(id),
  payee_kind   text check (payee_kind in ('vendor','employee','other')),
  vendor_id    uuid references public.vendors(id),
  employee_id  uuid,
  payee_text   text,
  amount       numeric not null default 0,
  gst_amount   numeric not null default 0,
  total        numeric not null default 0,
  has_bill     boolean not null default false,
  bill_no      text,
  note         text,
  status       text not null default 'unpaid' check (status in ('unpaid','paid')),
  approval_status   text not null default 'approved',
  assigned_approver uuid references public.profiles(id),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses(expense_date);

-- ------------------------------------------------- MONEY MOVEMENTS -------
-- The single source of truth for money OUT, and for any IN that is not a
-- sales-invoice receipt (those stay in public.payments).
create table if not exists public.cash_txns (
  id         bigint generated always as identity primary key,
  account_id uuid not null references public.cash_accounts(id),
  direction  text not null check (direction in ('in','out')),
  txn_date   date not null default current_date,
  amount     numeric not null check (amount > 0),
  mode       text,
  ref_type   text,      -- payable | expense | advance | salary | transfer | other
  ref_id     text,
  note       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists cash_txns_acct_date_idx on public.cash_txns(account_id, txn_date);

-- receipts need to know which account they landed in
alter table public.payments add column if not exists account_id uuid references public.cash_accounts(id);
update public.payments p set account_id = (select id from public.cash_accounts where kind='bank' limit 1)
 where p.account_id is null;

-- ------------------------------------------------------ DAILY CLOSE ------
create table if not exists public.day_close (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.cash_accounts(id),
  close_date       date not null,
  opening          numeric not null,
  receipts         numeric not null,
  payments         numeric not null,
  expected_closing numeric not null,
  actual_closing   numeric not null,
  difference       numeric not null,
  status           text not null default 'closed' check (status in ('closed')),
  note             text,
  closed_by        uuid references public.profiles(id),
  closed_at        timestamptz not null default now(),
  unique (account_id, close_date)
);

-- Position for a given account+date. Opening chains from the last close.
create or replace function public.day_position(p_account uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_rec numeric; v_pay numeric; v_acc public.cash_accounts%rowtype;
begin
  select * into v_acc from public.cash_accounts where id = p_account;
  if not found then raise exception 'Account not found'; end if;

  select actual_closing into v_open from public.day_close
   where account_id = p_account and close_date < p_date
   order by close_date desc limit 1;
  if v_open is null then v_open := v_acc.opening_balance; end if;

  select coalesce(sum(amount),0) into v_rec from (
    select amount from public.cash_txns
     where account_id = p_account and txn_date = p_date and direction = 'in'
    union all
    select amount from public.payments
     where account_id = p_account and paid_on = p_date
  ) s;

  select coalesce(sum(amount),0) into v_pay from public.cash_txns
   where account_id = p_account and txn_date = p_date and direction = 'out';

  return jsonb_build_object(
    'opening', round(v_open,2), 'receipts', round(v_rec,2), 'payments', round(v_pay,2),
    'expected', round(v_open + v_rec - v_pay, 2),
    'closed', exists (select 1 from public.day_close where account_id=p_account and close_date=p_date)
  );
end $$;
grant execute on function public.day_position(uuid, date) to authenticated;

-- Close a day. Approver/admin only. Difference allowed, but the note is required.
create or replace function public.close_day(p_account uuid, p_date date, p_actual numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pos jsonb; v_diff numeric; v_id uuid;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can close a day';
  end if;
  if exists (select 1 from public.day_close where account_id=p_account and close_date=p_date) then
    raise exception 'That day is already closed';
  end if;
  pos := public.day_position(p_account, p_date);
  v_diff := round(p_actual - (pos->>'expected')::numeric, 2);
  if v_diff <> 0 and coalesce(btrim(p_note),'') = '' then
    raise exception 'The closing balance does not match (difference %). A note is required to close with a difference.', v_diff;
  end if;

  insert into public.day_close(account_id, close_date, opening, receipts, payments,
                               expected_closing, actual_closing, difference, note, closed_by)
  values (p_account, p_date, (pos->>'opening')::numeric, (pos->>'receipts')::numeric,
          (pos->>'payments')::numeric, (pos->>'expected')::numeric, p_actual, v_diff, p_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'day_closed', 'day_close', v_id::text,
            p_date::text||' · difference '||v_diff);
  return v_id;
end $$;
grant execute on function public.close_day(uuid, date, numeric, text) to authenticated;

-- Reopen a closed day. Approver/admin only, audit-logged.
create or replace function public.reopen_day(p_account uuid, p_date date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can reopen a day';
  end if;
  if exists (select 1 from public.day_close
              where account_id=p_account and close_date > p_date) then
    raise exception 'A later day is already closed — reopen the most recent day first';
  end if;
  delete from public.day_close where account_id=p_account and close_date=p_date;
  if not found then raise exception 'That day is not closed'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'day_reopened', 'day_close', p_account::text, p_date::text||' · '||coalesce(p_note,''));
end $$;
grant execute on function public.reopen_day(uuid, date, text) to authenticated;

-- Refuse movements dated into a day that is already closed.
create or replace function public.guard_closed_day()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.day_close
              where account_id = new.account_id
                and close_date = coalesce(new.txn_date, new.paid_on)) then
    raise exception 'That day is closed. An approver must reopen it before entering or changing anything dated %',
      coalesce(new.txn_date, new.paid_on);
  end if;
  return new;
end $$;
drop trigger if exists cash_txns_closed_guard on public.cash_txns;
create trigger cash_txns_closed_guard before insert or update on public.cash_txns
  for each row execute function public.guard_closed_day();

-- ------------------------------------------------------------ RLS --------
do $$ declare t text;
begin
  foreach t in array array['cash_accounts','payables','expense_categories','expenses','cash_txns','day_close'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format('drop policy if exists %I_upd on public.%I;', t, t);
    execute format('drop policy if exists %I_del on public.%I;', t, t);
    execute format('create policy %I_read  on public.%I for select to authenticated using (public.is_internal());', t, t);
    execute format('create policy %I_write on public.%I for insert to authenticated with check (public.is_internal());', t, t);
    execute format('create policy %I_upd   on public.%I for update to authenticated using (public.is_internal());', t, t);
    execute format('create policy %I_del   on public.%I for delete to authenticated using (public.has_role(array[''admin'']::user_role[]));', t, t);
  end loop;
end $$;

-- --------------------------------------------------------- DASHBOARD -----
-- Red flags: days closed with a difference, and gaps that were never closed.
create or replace view public.v_accounting_flags as
  select a.id as account_id, a.name as account_name,
         d.close_date, d.difference, d.note, d.closed_at
    from public.day_close d
    join public.cash_accounts a on a.id = d.account_id
   where d.difference <> 0;
grant select on public.v_accounting_flags to authenticated;

-- Live payables position.
create or replace view public.v_payables_open as
  select p.*, coalesce(v.firm_name, v.name) as vendor_name,
         p.total - coalesce((select sum(c.amount) from public.cash_txns c
                              where c.ref_type='payable' and c.ref_id = p.id::text), 0) as balance
    from public.payables p
    left join public.vendors v on v.id = p.vendor_id
   where p.status <> 'paid';
grant select on public.v_payables_open to authenticated;
