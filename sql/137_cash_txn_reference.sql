-- ============================================================================
-- 137. Payment/settlement reference number on cash transactions
-- ----------------------------------------------------------------------------
-- Captures the UTR / cheque no. / payment reference entered in the shared
-- Payment & Settlement window, stored on the cash_txn (the settlement record).
-- Additive & idempotent.
-- ============================================================================
alter table public.cash_txns add column if not exists reference text;
comment on column public.cash_txns.reference is 'Payment reference (UTR / cheque no. / ref) from the settlement window.';
