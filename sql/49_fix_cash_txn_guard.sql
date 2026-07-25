-- ============================================================================
-- 49. Fix: "record 'new' has no field 'paid_on'" when recording any money-out
-- ----------------------------------------------------------------------------
-- guard_closed_day() (sql/40) fires on cash_txns but references new.paid_on,
-- a column that exists on public.payments, not on public.cash_txns. PL/pgSQL
-- must resolve every field in the SQL expression, so it errored on EVERY
-- cash_txns insert — vendor/expense payments, Day Book movements and issuing an
-- advance. It only surfaced now because this is the first real money-out entry.
--
-- The receipt side already has its own correct guard (guard_closed_day_payment,
-- sql/43). This one belongs to cash_txns only, so it uses txn_date alone.
-- Additive — replaces one function; nothing dropped, no data deleted.
-- ============================================================================

create or replace function public.guard_closed_day()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.day_close
              where account_id = new.account_id
                and close_date = new.txn_date) then
    raise exception
      'That day is closed for this account. An approver must reopen % before entering or changing a movement on it.',
      new.txn_date;
  end if;
  return new;
end $$;
