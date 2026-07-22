-- ============================================================================
-- 41. Accounting Phase B/C — Advances, and the live position dashboard
-- ----------------------------------------------------------------------------
-- An advance is money paid out BEFORE the expense is known (tour, fuel, vendor
-- advance against a PO). It stays outstanding until settled — either by the
-- expenses the person actually incurred, or by returning the balance.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

create table if not exists public.advances (
  id          uuid primary key default gen_random_uuid(),
  party_kind  text not null check (party_kind in ('employee','vendor','other')),
  employee_id uuid,
  vendor_id   uuid references public.vendors(id),
  payee_text  text,
  amount      numeric not null check (amount > 0),
  issued_on   date not null default current_date,
  purpose     text,
  status      text not null default 'open' check (status in ('open','settled')),
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists advances_status_idx on public.advances(status);

-- How an advance was accounted for: expenses it covered, or cash returned.
create table if not exists public.advance_settlements (
  id         uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.advances(id) on delete cascade,
  kind       text not null check (kind in ('expense','repayment','write_off')),
  ref_id     text,                       -- expenses.id when kind='expense'
  amount     numeric not null check (amount > 0),
  settled_on date not null default current_date,
  note       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists adv_settle_idx on public.advance_settlements(advance_id);

-- Outstanding advances, with who holds the money.
create or replace view public.v_advances_open as
  select a.*,
         coalesce(v.firm_name, v.name, a.payee_text) as party_name,
         coalesce((select sum(s.amount) from public.advance_settlements s
                    where s.advance_id = a.id), 0)   as settled,
         a.amount - coalesce((select sum(s.amount) from public.advance_settlements s
                               where s.advance_id = a.id), 0) as outstanding
    from public.advances a
    left join public.vendors v on v.id = a.vendor_id;
grant select on public.v_advances_open to authenticated;

-- Close an advance once it is fully accounted for (or write the rest off).
create or replace function public.settle_advance(p_id uuid, p_kind text, p_ref text,
                                                 p_amount numeric, p_on date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_out numeric;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  insert into public.advance_settlements(advance_id, kind, ref_id, amount, settled_on, note, created_by)
    values (p_id, p_kind, p_ref, p_amount, coalesce(p_on, current_date), p_note, auth.uid());

  select outstanding into v_out from public.v_advances_open where id = p_id;
  if v_out <= 0.005 then
    update public.advances set status='settled' where id = p_id;
  end if;

  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'advance_settled', 'advances', p_id::text, p_kind||' '||p_amount);
end $$;
grant execute on function public.settle_advance(uuid, text, text, numeric, date, text) to authenticated;

-- ------------------------------------------------- LIVE POSITION ---------
-- Days that have money movement but were never closed — the other red flag.
create or replace view public.v_days_unclosed as
  select s.account_id, a.name as account_name, s.day
    from (
      select account_id, txn_date as day from public.cash_txns
      union
      select account_id, paid_on  as day from public.payments where account_id is not null
    ) s
    join public.cash_accounts a on a.id = s.account_id
   where not exists (select 1 from public.day_close d
                      where d.account_id = s.account_id and d.close_date = s.day)
   group by s.account_id, a.name, s.day;
grant select on public.v_days_unclosed to authenticated;

-- Receivables position (sales invoices less receipts and credit notes).
create or replace view public.v_receivables_open as
  select d.id, d.number, d.doc_date, d.entity,
         coalesce((d.party_snapshot->>'firmName'), (d.party_snapshot->>'name')) as party_name,
         coalesce((d.totals->>'total')::numeric, 0) as invoiced,
         coalesce((select sum(p.amount) from public.payments p where p.document_id = d.id), 0) as received,
         coalesce((select sum(coalesce((c.totals->>'total')::numeric,0)) from public.documents c
                    where c.doc_type='credit_note' and c.related_doc_id = d.id), 0) as credited,
         coalesce((d.totals->>'total')::numeric, 0)
           - coalesce((select sum(p.amount) from public.payments p where p.document_id = d.id), 0)
           - coalesce((select sum(coalesce((c.totals->>'total')::numeric,0)) from public.documents c
                        where c.doc_type='credit_note' and c.related_doc_id = d.id), 0) as balance,
         greatest(0, current_date - d.doc_date) as age_days
    from public.documents d
   where d.doc_type = 'invoice';
grant select on public.v_receivables_open to authenticated;
