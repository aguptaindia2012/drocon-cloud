-- ============================================================================
-- 69. Delete a supplier (vendor) invoice safely
-- ----------------------------------------------------------------------------
-- Expense Management → Supplier (Vendor) Invoices had no delete. A payable posts
-- a journal entry (post_payable: Dr expense / Cr A/P) and has no delete-trigger,
-- so a raw delete would orphan those ledger rows. This RPC:
--   * refuses if any payment (cash_txns ref_type=payable) or credit note exists
--     — remove those first from the Payments screen;
--   * reverses the payable's journal entries;
--   * clears any vendor-invoice link (vendor_invoices.payable_id → null);
--   * deletes the payable.
-- Internal only. Additive / idempotent.
-- ============================================================================

create or replace function public.delete_payable(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pay int; v_cr int;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if not exists (select 1 from public.payables where id = p_id) then
    raise exception 'Invoice not found'; end if;

  select count(*) into v_pay from public.cash_txns where ref_type='payable' and ref_id = p_id::text;
  select count(*) into v_cr  from public.payable_credits where payable_id = p_id;
  if v_pay > 0 or v_cr > 0 then
    raise exception 'Cannot delete: this invoice has % payment(s) and % credit note(s). Remove them from the Payments screen first.', v_pay, v_cr;
  end if;

  -- unlink any vendor acre-invoice that created this payable (avoids FK violation)
  update public.vendor_invoices set payable_id = null where payable_id = p_id;
  -- reverse the journal entry this payable posted
  delete from public.accounting_entries where ref_type='payable' and ref_id = p_id::text;
  -- remove the payable
  delete from public.payables where id = p_id;

  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'deleted', 'payables', p_id::text, 'supplier invoice deleted');
end $$;
grant execute on function public.delete_payable(uuid) to authenticated;
