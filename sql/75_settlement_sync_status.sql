-- ============================================================================
-- 75. Fix: settlement did not update the OTHER item's status
-- ----------------------------------------------------------------------------
-- Balances already net settlements via the views, but each item's status flag
-- (paid / unpaid / settled chip) was only recomputed on the side that initiated
-- the settlement. So the settled-against item (an advance, a vendor invoice…)
-- kept its old status. apply_settlement / delete_settlement now refresh BOTH
-- items' status from their live balance. Additive / idempotent.
-- ============================================================================

-- Set an item's status column from its current open-items balance.
create or replace function public.sync_settlement_item(p_type text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare g numeric; b numeric;
begin
  select gross, balance into g, b from public.v_open_items where type = p_type and item_id = p_id;

  if p_type = 'client_invoice' then
    update public.documents set status = case when coalesce(b,0) <= 0.01 then 'paid'
                                              when coalesce(b,0) <  coalesce(g,0)-0.01 then 'partial'
                                              else 'issued' end
     where id::text = p_id and doc_type = 'invoice';
  elsif p_type = 'vendor_payable' then
    update public.payables set status = case when coalesce(b,0) <= 0.01 then 'paid'
                                             when coalesce(b,0) <  coalesce(g,0)-0.01 then 'part_paid'
                                             else 'unpaid' end
     where id::text = p_id;
  elsif p_type = 'expense' then
    update public.expenses set status = case when coalesce(b,0) <= 0.01 then 'paid'
                                             when coalesce(b,0) <  coalesce(g,0)-0.01 then 'part_paid'
                                             else 'unpaid' end
     where id::text = p_id;
  elsif p_type = 'expense_claim' then
    update public.expense_claims set status = case when coalesce(b,0) <= 0.01 then 'paid' else status end
     where id::text = p_id;
  elsif p_type = 'advance' then
    update public.advances set status = case when b is null then status
                                             when b <= 0.01 then 'settled' else 'open' end
     where id::text = p_id;
  elsif p_type = 'salary' then
    update public.salary_runs set status = case when coalesce(b,0) <= 0.01 then 'paid' else status end
     where id::text = p_id;
  end if;
end $$;
grant execute on function public.sync_settlement_item(text, text) to authenticated;

-- Rewrite apply_settlement to sync BOTH sides after posting.
create or replace function public.apply_settlement(
  p_a_type text, p_a_id text, p_a_label text,
  p_b_type text, p_b_id text, p_b_label text,
  p_amount numeric, p_date date, p_note text, p_initiated_from text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a_acct text; a_side text; b_acct text; b_side text; dr_acct text; cr_acct text; rid uuid;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  select account, side into a_acct, a_side from public.settle_meta(p_a_type);
  select account, side into b_acct, b_side from public.settle_meta(p_b_type);
  if a_acct is null or b_acct is null then raise exception 'Unknown item type'; end if;
  if a_side = b_side then
    raise exception 'A settlement must pair a receivable (owed to us) with a payable (owed by us).'; end if;

  if a_side = 'payable' then dr_acct := a_acct; cr_acct := b_acct;
  else dr_acct := b_acct; cr_acct := a_acct; end if;

  insert into public.settlements(settle_date, amount, a_type, a_id, a_label, b_type, b_id, b_label, note, initiated_from, created_by)
    values (coalesce(p_date,current_date), p_amount, p_a_type, p_a_id, p_a_label, p_b_type, p_b_id, p_b_label, p_note, p_initiated_from, auth.uid())
    returning id into rid;

  insert into public.accounting_entries(voucher_date, narration, account, debit, credit, ref_type, ref_id, created_by)
    values (coalesce(p_date,current_date), 'Settlement: '||coalesce(p_a_label,'')||' <-> '||coalesce(p_b_label,''), dr_acct, p_amount, 0, 'settlement', rid::text, auth.uid()),
           (coalesce(p_date,current_date), 'Settlement: '||coalesce(p_a_label,'')||' <-> '||coalesce(p_b_label,''), cr_acct, 0, p_amount, 'settlement', rid::text, auth.uid());

  perform public.sync_settlement_item(p_a_type, p_a_id);
  perform public.sync_settlement_item(p_b_type, p_b_id);
  return rid;
end $$;
grant execute on function public.apply_settlement(text,text,text,text,text,text,numeric,date,text,text) to authenticated;

-- Rewrite delete_settlement to restore BOTH sides' status after reversal.
create or replace function public.delete_settlement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.settlements%rowtype;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select * into s from public.settlements where id = p_id;
  if s.id is null then raise exception 'Settlement not found'; end if;
  delete from public.accounting_entries where ref_type='settlement' and ref_id = p_id::text;
  delete from public.settlements where id = p_id;
  perform public.sync_settlement_item(s.a_type, s.a_id);
  perform public.sync_settlement_item(s.b_type, s.b_id);
  insert into public.audit_log(actor,action,entity,entity_id,note) values (auth.uid(),'settlement_deleted','settlements',p_id::text,null);
end $$;
grant execute on function public.delete_settlement(uuid) to authenticated;

-- Backfill: correct the status of every item touched by an EXISTING settlement.
do $$ declare r record;
begin
  for r in (select a_type as t, a_id as i from public.settlements
            union select b_type, b_id from public.settlements) loop
    perform public.sync_settlement_item(r.t, r.i);
  end loop;
end $$;
