-- ============================================================================
-- 36. Stamp acre rows as billed, and release them if the document is deleted
-- ----------------------------------------------------------------------------
-- Acre rows are locked to approver-only UPDATE (sql/31), so billing marks go
-- through a SECURITY DEFINER function — that way anyone allowed to raise an
-- invoice can stamp the rows, without opening up acre editing.
-- Each side is stamped independently: 'farmer' (0% Bill of Supply) and
-- 'client' (18% Marketing Expense / Subsidy).
-- ============================================================================

create or replace function public.mark_acre_billed(p_ids bigint[], p_doc uuid, p_side text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if p_side = 'farmer' then
    update public.acre_entries
       set farmer_doc_id = p_doc, farmer_billed_at = now()
     where id = any(p_ids) and farmer_doc_id is null;
  elsif p_side = 'client' then
    update public.acre_entries
       set client_doc_id = p_doc, client_billed_at = now()
     where id = any(p_ids) and client_doc_id is null;
  else
    raise exception 'side must be farmer or client';
  end if;
  get diagnostics n = row_count;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'acre_billed', 'documents', p_doc::text, n||' acre row(s) · '||p_side);
  return n;
end $$;

-- Releasing lets the rows be re-billed (used when a document is deleted).
create or replace function public.unmark_acre_billed(p_doc uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; m integer;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  update public.acre_entries set farmer_doc_id = null, farmer_billed_at = null
   where farmer_doc_id = p_doc;
  get diagnostics n = row_count;
  update public.acre_entries set client_doc_id = null, client_billed_at = null
   where client_doc_id = p_doc;
  get diagnostics m = row_count;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'acre_unbilled', 'documents', p_doc::text, (n+m)||' acre row(s) released');
  return n + m;
end $$;

grant execute on function public.mark_acre_billed(bigint[], uuid, text) to authenticated;
grant execute on function public.unmark_acre_billed(uuid)               to authenticated;

-- ---- unbilled summary for the dashboard signal -----------------------------
create or replace view public.v_acre_unbilled_summary as
  select l.id as location_id, l.name as location_name,
         l.farmer_bill_to, fc.firm_name as farmer_client_name,
         l.client_bill_to, cc.firm_name as client_client_name,
         count(*) filter (where a.farmer_doc_id is null)                        as farmer_rows,
         round(sum(a.acres) filter (where a.farmer_doc_id is null), 2)          as farmer_acres,
         round(sum(a.acres * coalesce(a.farmer_rate, l.farmer_rate, 0))
                 filter (where a.farmer_doc_id is null), 2)                     as farmer_value,
         count(*) filter (where a.client_doc_id is null
                            and coalesce(l.client_rate,0) > 0)                  as client_rows,
         round(sum(a.acres * coalesce(a.client_rate, l.client_rate, 0))
                 filter (where a.client_doc_id is null
                           and coalesce(l.client_rate,0) > 0), 2)               as client_value,
         min(a.entry_date) as oldest_unbilled
    from public.acre_entries a
    join public.spray_locations l on l.id = a.location_id
    left join public.clients fc on fc.id = l.farmer_bill_to
    left join public.clients cc on cc.id = l.client_bill_to
   where a.farmer_doc_id is null
      or (a.client_doc_id is null and coalesce(l.client_rate,0) > 0)
   group by l.id, l.name, l.farmer_bill_to, fc.firm_name, l.client_bill_to, cc.firm_name;
grant select on public.v_acre_unbilled_summary to authenticated;
