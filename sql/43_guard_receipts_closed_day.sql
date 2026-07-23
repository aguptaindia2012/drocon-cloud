-- ============================================================================
-- 43. Stop a receipt slipping into a day that is already closed
-- ----------------------------------------------------------------------------
-- The closed-day guard was only on cash_txns. A collection (public.payments)
-- back-dated into a closed day therefore bypassed it: the day_close figures are
-- frozen and the next opening chains from that frozen actual, so the receipt
-- would be orphaned — in the journal but not in the reconciliation.
--
-- payments has no txn_date column, so it needs its own guard function that
-- keys on paid_on. It only fires when an account is set, so the historical
-- Tracker-import receipts (account_id null, invisible to the Day Book by design)
-- are unaffected.
-- Additive — nothing dropped, no data deleted.
-- ============================================================================

create or replace function public.guard_closed_day_payment()
returns trigger language plpgsql as $$
begin
  if new.account_id is not null
     and exists (select 1 from public.day_close
                  where account_id = new.account_id and close_date = new.paid_on) then
    raise exception
      'That day is closed for this account. An approver must reopen % before recording or changing a receipt on it.',
      new.paid_on;
  end if;
  return new;
end $$;

drop trigger if exists payments_closed_guard on public.payments;
create trigger payments_closed_guard before insert or update on public.payments
  for each row execute function public.guard_closed_day_payment();
