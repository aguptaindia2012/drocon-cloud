-- ============================================================================
-- 50. Vendor credit notes against supplier invoices (payables)
-- ----------------------------------------------------------------------------
-- A credit note received FROM a vendor reduces what DroCon owes them, so the
-- balance on a supplier invoice becomes: total − payments − credits. Client-side
-- credit notes (DroCon → client) already net against receivables via the
-- documents table; this is the mirror for the payable side.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

create table if not exists public.payable_credits (
  id          uuid primary key default gen_random_uuid(),
  payable_id  uuid not null references public.payables(id) on delete cascade,
  credit_no   text,
  credit_date date not null default current_date,
  amount      numeric not null check (amount > 0),
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists payable_credits_idx on public.payable_credits(payable_id);

alter table public.payable_credits enable row level security;
drop policy if exists pcredit_read  on public.payable_credits;
drop policy if exists pcredit_write on public.payable_credits;
drop policy if exists pcredit_del   on public.payable_credits;
create policy pcredit_read  on public.payable_credits for select to authenticated using (public.is_internal());
create policy pcredit_write on public.payable_credits for insert to authenticated with check (public.is_internal());
create policy pcredit_del   on public.payable_credits for delete to authenticated using (public.is_internal());

-- Open payables now net payments AND credits.
create or replace view public.v_payables_open as
  select p.*, coalesce(v.firm_name, v.name) as vendor_name,
         coalesce((select sum(c.amount) from public.cash_txns c
                    where c.ref_type='payable' and c.ref_id = p.id::text), 0) as paid,
         coalesce((select sum(pc.amount) from public.payable_credits pc
                    where pc.payable_id = p.id), 0) as credited,
         p.total
           - coalesce((select sum(c.amount) from public.cash_txns c
                        where c.ref_type='payable' and c.ref_id = p.id::text), 0)
           - coalesce((select sum(pc.amount) from public.payable_credits pc
                        where pc.payable_id = p.id), 0) as balance
    from public.payables p
    left join public.vendors v on v.id = p.vendor_id
   where p.status <> 'paid';
grant select on public.v_payables_open to authenticated;

-- Journal: a vendor credit reduces the liability and reverses the cost.
--   Dr Accounts Payable, Cr Purchase Returns.
create or replace function public.post_payable_credit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounting_entries where ref_type='payable_credit' and ref_id = new.id::text;
  insert into public.accounting_entries(voucher_date,narration,account,debit,credit,ref_type,ref_id,created_by)
    values (new.credit_date, coalesce(new.credit_no,'Vendor credit note'),
            'Accounts Payable', new.amount, 0, 'payable_credit', new.id::text, new.created_by),
           (new.credit_date, coalesce(new.credit_no,'Vendor credit note'),
            'Purchase Returns', 0, new.amount, 'payable_credit', new.id::text, new.created_by);
  return new;
end $$;
drop trigger if exists payable_credit_journal on public.payable_credits;
create trigger payable_credit_journal after insert on public.payable_credits
  for each row execute function public.post_payable_credit();

create or replace function public.unpost_payable_credit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounting_entries where ref_type='payable_credit' and ref_id = old.id::text;
  return old;
end $$;
drop trigger if exists payable_credit_unjournal on public.payable_credits;
create trigger payable_credit_unjournal after delete on public.payable_credits
  for each row execute function public.unpost_payable_credit();
