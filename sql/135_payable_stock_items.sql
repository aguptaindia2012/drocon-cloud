-- ============================================================================
-- 135. Optional stock items on supplier (vendor) invoices
-- ----------------------------------------------------------------------------
-- Vendor bills stay amount-only by default. Optionally the user lists the stock
-- items received (spare + qty); on save the app adds them to stock. Because
-- inventory_moves.ref_doc_id FKs to documents (sales), purchase moves link via
-- a new ref_payable_id, and a dedicated function applies them atomically.
-- Additive & idempotent.
-- ============================================================================
alter table public.payables        add column if not exists stock_items   jsonb;
alter table public.inventory_moves add column if not exists ref_payable_id uuid;

do $$ begin
  alter table public.inventory_moves
    add constraint inventory_moves_ref_payable_fk
    foreign key (ref_payable_id) references public.payables(id) on delete set null;
exception when duplicate_object then null; end $$;

comment on column public.payables.stock_items        is 'Optional [{spare_id,name,qty}] received on this bill; added to stock via apply_payable_stock.';
comment on column public.inventory_moves.ref_payable_id is 'Links a stock move to the supplier invoice (payable) that created it.';

-- Reverse this payable's previous stock moves, then add the new ones (one txn).
create or replace function public.apply_payable_stock(p_payable_id uuid, p_number text, p_moves jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  delete from public.inventory_moves where ref_payable_id = p_payable_id;
  insert into public.inventory_moves(spare_id, qty, direction, reason, purchase_invoice_no, ref_payable_id, created_by)
    select (m->>'spare_id')::uuid, (m->>'qty')::numeric, 'in',
           'purchase '||coalesce(p_number,''), p_number, p_payable_id, auth.uid()
    from jsonb_array_elements(p_moves) m
    where (m->>'spare_id') is not null and coalesce((m->>'qty')::numeric,0) <> 0;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.apply_payable_stock(uuid, text, jsonb) to authenticated;
