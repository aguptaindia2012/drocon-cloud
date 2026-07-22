-- ============================================================================
-- 37. Payment status flows back to the acre data + partial release for credits
-- ----------------------------------------------------------------------------
-- (10) Marking an invoice paid now shows against the acre rows it billed, so
--      you can see exactly which sprayed acres are still awaiting payment.
-- (9)  Credit notes raised from acre data release the credited rows so they can
--      be billed again correctly.
-- ============================================================================

-- ---- per-acre-row billing + payment status --------------------------------
create or replace view public.v_acre_payment as
with doc_paid as (
  select d.id,
         coalesce((d.totals->>'total')::numeric, 0) as total,
         coalesce((select sum(p.amount) from public.payments p where p.document_id = d.id), 0) as paid
    from public.documents d
)
select a.id                        as acre_id,
       a.entry_date, a.location_id, a.acres, a.pilot_id, a.pilot_name,
       -- farmer side (0% Bill of Supply)
       a.farmer_doc_id, fd.number  as farmer_doc_no,
       fp.total as farmer_total, fp.paid as farmer_paid,
       case when a.farmer_doc_id is null                       then 'unbilled'
            when fp.paid >= fp.total - 0.01 and fp.total > 0    then 'paid'
            when fp.paid > 0                                    then 'partial'
            else 'unpaid' end      as farmer_status,
       -- client side (18% Marketing Expense / Subsidy)
       a.client_doc_id, cd.number  as client_doc_no,
       cp.total as client_total, cp.paid as client_paid,
       case when a.client_doc_id is null                       then 'unbilled'
            when cp.paid >= cp.total - 0.01 and cp.total > 0    then 'paid'
            when cp.paid > 0                                    then 'partial'
            else 'unpaid' end      as client_status
  from public.acre_entries a
  left join public.documents fd on fd.id = a.farmer_doc_id
  left join doc_paid        fp on fp.id  = a.farmer_doc_id
  left join public.documents cd on cd.id = a.client_doc_id
  left join doc_paid        cp on cp.id  = a.client_doc_id;
grant select on public.v_acre_payment to authenticated;

-- ---- release specific rows (used when part of an invoice is credited) -----
create or replace function public.release_acre_rows(p_ids bigint[], p_side text)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if p_side = 'farmer' then
    update public.acre_entries set farmer_doc_id = null, farmer_billed_at = null
     where id = any(p_ids);
  elsif p_side = 'client' then
    update public.acre_entries set client_doc_id = null, client_billed_at = null
     where id = any(p_ids);
  else
    raise exception 'side must be farmer or client';
  end if;
  get diagnostics n = row_count;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'acre_released', 'acre_entries', '', n||' row(s) released for re-billing · '||p_side);
  return n;
end $$;
grant execute on function public.release_acre_rows(bigint[], text) to authenticated;

-- ---- roll-up of unpaid billed acre work, for the dashboard ---------------
create or replace view public.v_acre_payment_summary as
  select l.id as location_id, l.name as location_name,
         count(*) filter (where v.farmer_status in ('unpaid','partial'))            as farmer_open_rows,
         round(sum(v.acres) filter (where v.farmer_status in ('unpaid','partial')),2) as farmer_open_acres,
         count(*) filter (where v.client_status in ('unpaid','partial'))            as client_open_rows,
         min(v.entry_date) filter (where v.farmer_status in ('unpaid','partial'))   as oldest_unpaid
    from public.v_acre_payment v
    join public.spray_locations l on l.id = v.location_id
   where v.farmer_status in ('unpaid','partial') or v.client_status in ('unpaid','partial')
   group by l.id, l.name;
grant select on public.v_acre_payment_summary to authenticated;
