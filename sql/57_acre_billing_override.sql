-- ============================================================================
-- 57. Override old acre work as "already billed" (clear the backlog cleanly)
-- ----------------------------------------------------------------------------
-- Historic sprayed acres were billed outside the app; they should not keep
-- nagging as "unbilled". This adds a reversible override flag (the acre data
-- itself is untouched) so such rows drop out of the unbilled signal and the
-- Acre Invoicing picker, and read as "written-off / pre-billed" in payment
-- status — without creating a phantom invoice or receivable.
-- Approver/admin only. Fully reversible via clear_acre_billing_override().
-- Additive: new columns + one RPC pair; recreates 4 views (same columns).
-- ============================================================================

alter table public.acre_entries add column if not exists farmer_billed_override boolean not null default false;
alter table public.acre_entries add column if not exists client_billed_override boolean not null default false;
alter table public.acre_entries add column if not exists billed_override_at   timestamptz;
alter table public.acre_entries add column if not exists billed_override_by   uuid references public.profiles(id);
alter table public.acre_entries add column if not exists billed_override_note text;

-- ---- mark as billed (override) --------------------------------------------
create or replace function public.override_acre_billed(
  p_side text, p_cutoff date, p_location_ids bigint[] default null, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; m integer;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can override billing.';
  end if;
  if p_side in ('farmer','both') then
    update public.acre_entries a
       set farmer_billed_override = true, billed_override_at = now(),
           billed_override_by = auth.uid(), billed_override_note = coalesce(p_note, a.billed_override_note)
     where a.farmer_doc_id is null and not a.farmer_billed_override
       and a.entry_date <= p_cutoff
       and (p_location_ids is null or a.location_id = any(p_location_ids));
    get diagnostics m = row_count; n := n + m;
  end if;
  if p_side in ('client','both') then
    update public.acre_entries a
       set client_billed_override = true, billed_override_at = now(),
           billed_override_by = auth.uid(), billed_override_note = coalesce(p_note, a.billed_override_note)
      from public.spray_locations l
     where l.id = a.location_id
       and a.client_doc_id is null and not a.client_billed_override
       and coalesce(a.client_rate, l.client_rate, 0) > 0
       and a.entry_date <= p_cutoff
       and (p_location_ids is null or a.location_id = any(p_location_ids));
    get diagnostics m = row_count; n := n + m;
  end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'acre_billing_override', 'acre_entries', '',
            n||' row(s) marked billed (override) · '||p_side||' · up to '||p_cutoff);
  return n;
end $$;
grant execute on function public.override_acre_billed(text, date, bigint[], text) to authenticated;

-- ---- undo the override (reversible) ---------------------------------------
create or replace function public.clear_acre_billing_override(
  p_side text, p_location_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; m integer;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can change billing overrides.';
  end if;
  if p_side in ('farmer','both') then
    update public.acre_entries a set farmer_billed_override = false
     where a.farmer_billed_override and (p_location_ids is null or a.location_id = any(p_location_ids));
    get diagnostics m = row_count; n := n + m;
  end if;
  if p_side in ('client','both') then
    update public.acre_entries a set client_billed_override = false
     where a.client_billed_override and (p_location_ids is null or a.location_id = any(p_location_ids));
    get diagnostics m = row_count; n := n + m;
  end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'acre_billing_override_cleared', 'acre_entries', '', n||' row(s) reverted · '||p_side);
  return n;
end $$;
grant execute on function public.clear_acre_billing_override(text, bigint[]) to authenticated;

-- ---- views now treat an override as billed --------------------------------
create or replace view public.v_acre_unbilled as
  select a.id, a.entry_date, a.location_id, l.name as location_name, l.client_id,
         a.pilot_id, a.pilot_name, a.acres, a.client_rate, a.farmer_rate, a.amount,
         (a.farmer_doc_id is null and not a.farmer_billed_override) as farmer_unbilled,
         (a.client_doc_id is null and not a.client_billed_override) as client_unbilled
    from public.acre_entries a
    left join public.spray_locations l on l.id = a.location_id
   where (a.farmer_doc_id is null and not a.farmer_billed_override)
      or (a.client_doc_id is null and not a.client_billed_override);
grant select on public.v_acre_unbilled to authenticated;

create or replace view public.v_acre_unbilled_summary as
  select l.id as location_id, l.name as location_name,
         l.farmer_bill_to, fc.firm_name as farmer_client_name,
         l.client_bill_to, cc.firm_name as client_client_name,
         count(*) filter (where a.farmer_doc_id is null and not a.farmer_billed_override)               as farmer_rows,
         round(sum(a.acres) filter (where a.farmer_doc_id is null and not a.farmer_billed_override), 2) as farmer_acres,
         round(sum(a.acres * coalesce(a.farmer_rate, l.farmer_rate, 0))
                 filter (where a.farmer_doc_id is null and not a.farmer_billed_override), 2)            as farmer_value,
         count(*) filter (where a.client_doc_id is null and not a.client_billed_override
                            and coalesce(l.client_rate,0) > 0)                                          as client_rows,
         round(sum(a.acres * coalesce(a.client_rate, l.client_rate, 0))
                 filter (where a.client_doc_id is null and not a.client_billed_override
                           and coalesce(l.client_rate,0) > 0), 2)                                       as client_value,
         min(a.entry_date) filter (where (a.farmer_doc_id is null and not a.farmer_billed_override)
                            or (a.client_doc_id is null and not a.client_billed_override
                                  and coalesce(l.client_rate,0) > 0))                                   as oldest_unbilled
    from public.acre_entries a
    join public.spray_locations l on l.id = a.location_id
    left join public.clients fc on fc.id = l.farmer_bill_to
    left join public.clients cc on cc.id = l.client_bill_to
   where (a.farmer_doc_id is null and not a.farmer_billed_override)
      or (a.client_doc_id is null and not a.client_billed_override and coalesce(l.client_rate,0) > 0)
   group by l.id, l.name, l.farmer_bill_to, fc.firm_name, l.client_bill_to, cc.firm_name;
grant select on public.v_acre_unbilled_summary to authenticated;

-- billing picker: expose the override flags so the app can skip them
create or replace view public.v_acre_billing as
  select a.id, a.entry_date, a.acres, a.crop, a.chemical,
         a.location_id, l.name as location_name, l.state, l.district,
         a.pilot_id, coalesce(p.name, a.pilot_name) as pilot_name,
         coalesce(a.farmer_rate, l.farmer_rate, 0) as farmer_rate,
         coalesce(a.client_rate, l.client_rate, 0) as client_rate,
         l.farmer_bill_to, fc.firm_name as farmer_client_name,
         l.client_bill_to, cc.firm_name as client_client_name,
         cc.client_rate_label,
         a.farmer_doc_id, a.client_doc_id,
         round(a.acres * coalesce(a.farmer_rate, l.farmer_rate, 0), 2) as farmer_amount,
         round(a.acres * coalesce(a.client_rate, l.client_rate, 0), 2) as client_amount,
         a.farmer_billed_override, a.client_billed_override
    from public.acre_entries a
    join public.spray_locations l on l.id = a.location_id
    left join public.pilots  p  on p.id  = a.pilot_id
    left join public.clients fc on fc.id = l.farmer_bill_to
    left join public.clients cc on cc.id = l.client_bill_to;
grant select on public.v_acre_billing to authenticated;

-- payment status: overrides read as "written-off" (billed outside the app)
create or replace view public.v_acre_payment as
with doc_paid as (
  select d.id,
         coalesce((d.totals->>'total')::numeric, 0) as total,
         coalesce((select sum(p.amount) from public.payments p where p.document_id = d.id), 0) as paid
    from public.documents d
)
select a.id                        as acre_id,
       a.entry_date, a.location_id, a.acres, a.pilot_id, a.pilot_name,
       a.farmer_doc_id, fd.number  as farmer_doc_no,
       fp.total as farmer_total, fp.paid as farmer_paid,
       case when a.farmer_billed_override                     then 'written-off'
            when a.farmer_doc_id is null                      then 'unbilled'
            when fp.paid >= fp.total - 0.01 and fp.total > 0   then 'paid'
            when fp.paid > 0                                   then 'partial'
            else 'unpaid' end      as farmer_status,
       a.client_doc_id, cd.number  as client_doc_no,
       cp.total as client_total, cp.paid as client_paid,
       case when a.client_billed_override                     then 'written-off'
            when a.client_doc_id is null                      then 'unbilled'
            when cp.paid >= cp.total - 0.01 and cp.total > 0   then 'paid'
            when cp.paid > 0                                   then 'partial'
            else 'unpaid' end      as client_status
  from public.acre_entries a
  left join public.documents fd on fd.id = a.farmer_doc_id
  left join doc_paid        fp on fp.id  = a.farmer_doc_id
  left join public.documents cd on cd.id = a.client_doc_id
  left join doc_paid        cp on cp.id  = a.client_doc_id;
grant select on public.v_acre_payment to authenticated;
