-- ============================================================================
-- 44. Backstop against duplicate receipts / payments from a double-submit
-- ----------------------------------------------------------------------------
-- The UI now disables the button on click, but a network retry or a second
-- device can still fire the same insert twice. These triggers reject an
-- IDENTICAL row created within a short window (same key fields, same user,
-- within 30 seconds). A genuine second part-payment differs in amount, date or
-- reference, so it is unaffected; only an exact repeat is blocked.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

-- Receipts (public.payments): same invoice, amount, date, account, user.
create or replace function public.dedupe_payment()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.payments p
     where p.document_id = new.document_id
       and p.amount      = new.amount
       and p.paid_on     = new.paid_on
       and coalesce(p.account_id::text,'') = coalesce(new.account_id::text,'')
       and p.created_by  = new.created_by
       and p.created_at  > now() - interval '30 seconds'
  ) then
    raise exception 'This exact receipt was just recorded a moment ago. Check the list before entering it again.';
  end if;
  return new;
end $$;
drop trigger if exists payments_dedupe on public.payments;
create trigger payments_dedupe before insert on public.payments
  for each row execute function public.dedupe_payment();

-- Money movements (public.cash_txns): same account, direction, amount, date,
-- what-it-settles and user.
create or replace function public.dedupe_cash_txn()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.cash_txns c
     where c.account_id = new.account_id
       and c.direction  = new.direction
       and c.amount     = new.amount
       and c.txn_date   = new.txn_date
       and coalesce(c.ref_type,'') = coalesce(new.ref_type,'')
       and coalesce(c.ref_id,'')   = coalesce(new.ref_id,'')
       and c.created_by = new.created_by
       and c.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'This exact payment was just recorded a moment ago. Check before entering it again.';
  end if;
  return new;
end $$;
drop trigger if exists cash_txns_dedupe on public.cash_txns;
create trigger cash_txns_dedupe before insert on public.cash_txns
  for each row execute function public.dedupe_cash_txn();
