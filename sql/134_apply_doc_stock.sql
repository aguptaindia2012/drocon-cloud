-- ============================================================================
-- 134. apply_doc_stock — atomically reverse + (re)apply a document's stock moves
-- ----------------------------------------------------------------------------
-- One transaction (a function = a transaction) so an invoice's stock can never
-- get out of sync. Used by sales invoices (direction 'out') and purchase/vendor
-- invoices (direction 'in'). On edit it first deletes the document's previous
-- moves (the inventory_moves trigger restores stock), then checks availability
-- for sales and inserts the new moves. If anything is short and negative stock
-- is not allowed, it raises and the whole thing rolls back (no change).
--
-- p_moves: jsonb array of { "spare_id": uuid, "qty": number }
-- Returns { ok:true }. On shortfall raises 'INSUFFICIENT_STOCK <json>' so the
-- app can show which items/available/requested (the app also pre-checks to warn
-- before saving; this is the atomic backstop).
-- ============================================================================
create or replace function public.apply_doc_stock(
  p_doc_id uuid, p_number text, p_direction text, p_moves jsonb, p_allow_negative boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare rec record; avail numeric; shortfalls jsonb := '[]'::jsonb;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if p_direction not in ('in','out') then raise exception 'bad direction'; end if;

  -- reverse any previous stock for this document (trigger restores current_stock)
  delete from public.inventory_moves where ref_doc_id = p_doc_id;

  -- sales: enforce availability unless negative stock is explicitly allowed
  if p_direction = 'out' and not coalesce(p_allow_negative, false) then
    for rec in
      select (m->>'spare_id')::uuid as sid, sum((m->>'qty')::numeric) as need
      from jsonb_array_elements(p_moves) m
      where (m->>'spare_id') is not null group by 1
    loop
      select coalesce(current_stock,0) into avail from public.spare_catalogue where id = rec.sid;
      if avail < rec.need then
        shortfalls := shortfalls || jsonb_build_object('spare_id', rec.sid, 'available', avail, 'requested', rec.need);
      end if;
    end loop;
    if jsonb_array_length(shortfalls) > 0 then
      raise exception 'INSUFFICIENT_STOCK %', shortfalls::text using errcode = 'P0001';
    end if;
  end if;

  -- apply the new moves
  insert into public.inventory_moves(spare_id, qty, direction, reason, sales_invoice_no, purchase_invoice_no, ref_doc_id, created_by)
    select (m->>'spare_id')::uuid, (m->>'qty')::numeric, p_direction,
           (case when p_direction='out' then 'invoice ' else 'purchase ' end) || coalesce(p_number,''),
           (case when p_direction='out' then p_number end),
           (case when p_direction='in'  then p_number end),
           p_doc_id, auth.uid()
    from jsonb_array_elements(p_moves) m
    where (m->>'spare_id') is not null and coalesce((m->>'qty')::numeric,0) <> 0;

  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.apply_doc_stock(uuid, text, text, jsonb, boolean) to authenticated;
