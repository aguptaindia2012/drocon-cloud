-- ============================================================================
-- 72. Keep the approval step on synced spray edits
-- ----------------------------------------------------------------------------
-- Non-approvers propose an edit; it parks on the acre row (pending_changes) and
-- shows in Review / Approvals, exactly like before. When the parked change is a
-- SYNCED spray edit (pending_changes carries "_synced": true), approving it
-- applies to BOTH acre_entries and farmer_sprays via edit_spray() so the two
-- sides never drift. Otherwise the original acre-only apply runs unchanged.
-- Replaces one function. Additive.
-- ============================================================================

create or replace function public.approve_acre_edit(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c jsonb; src uuid;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can approve';
  end if;
  select pending_changes, source_id into c, src from public.acre_entries where id = p_id;
  if c is null then raise exception 'Nothing pending on this entry'; end if;

  -- synced edit → re-record both sides together
  if coalesce((c->>'_synced')::boolean, false) and src is not null then
    perform public.edit_spray(
      src,
      (c->>'entry_date')::date,
      nullif(c->>'location_id','')::uuid,
      c->>'pilot_name',
      (c->>'acres')::numeric,
      (c->>'client_rate')::numeric,
      (c->>'farmer_rate')::numeric,
      c->>'crop',
      nullif(c->>'crop_id','')::uuid,
      c->>'chemical',
      c->>'farmer',
      c->>'phone',
      c->>'village',
      coalesce((c->>'gps')::boolean, false));
    update public.acre_entries
       set pending_changes = null, approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
     where id = p_id;
    insert into public.audit_log(actor, action, entity, entity_id, note)
      values (auth.uid(), 'edit_approved', 'spray', src::text, 're-recorded acre + farmer on approval');
    return;
  end if;

  -- legacy acre-only apply
  update public.acre_entries set
    entry_date   = coalesce((c->>'entry_date')::date,    entry_date),
    location_id  = coalesce(nullif(c->>'location_id','')::uuid, location_id),
    pilot_name   = coalesce(c->>'pilot_name',   pilot_name),
    acres        = coalesce((c->>'acres')::numeric,       acres),
    client_rate  = coalesce((c->>'client_rate')::numeric, client_rate),
    farmer_rate  = coalesce((c->>'farmer_rate')::numeric, farmer_rate),
    rate         = coalesce((c->>'rate')::numeric,        rate),
    amount       = coalesce((c->>'amount')::numeric,      amount),
    crop         = coalesce(c->>'crop',       crop),
    chemical     = coalesce(c->>'chemical',   chemical),
    pending_changes = null, approval_status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_id;

  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'edit_approved', 'acre_entries', p_id::text, null);
end $$;
grant execute on function public.approve_acre_edit(bigint) to authenticated;
