-- ============================================================================
-- 31. (a) Acre entries: edit-requires-approval (change-on-approve)
--     (b) Catalogue: usage lookup so an item can only be deleted when unused
-- ----------------------------------------------------------------------------
-- (a) mirrors the inventory_moves pattern from sql/28: the first entry is free,
--     any later CHANGE by a non-approver is parked in pending_changes and only
--     applied to the row when an admin/approver approves it.
-- (b) catalogue_usage() reports stock + document/inventory references so the UI
--     can block deletion of an item that is actually in use.
-- Run this whole file in Supabase -> SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------- (a) ACRE --
alter table public.acre_entries add column if not exists approval_status   text not null default 'approved';
alter table public.acre_entries add column if not exists pending_changes   jsonb;
alter table public.acre_entries add column if not exists assigned_approver uuid references public.profiles(id);
alter table public.acre_entries add column if not exists submitted_by      uuid references public.profiles(id);
alter table public.acre_entries add column if not exists submitted_at      timestamptz;
alter table public.acre_entries add column if not exists approved_by       uuid references public.profiles(id);
alter table public.acre_entries add column if not exists approved_at       timestamptz;
alter table public.acre_entries add column if not exists reject_note       text;

-- New rows are live immediately (first entry is free of approval).
create or replace function public.acre_entry_new_defaults()
returns trigger language plpgsql as $$
begin
  new.approval_status := 'approved';
  new.pending_changes := null;
  return new;
end $$;
drop trigger if exists acre_entry_defaults on public.acre_entries;
create trigger acre_entry_defaults before insert on public.acre_entries
  for each row execute function public.acre_entry_new_defaults();

-- Only an approver/admin may write the row directly; everyone else must propose.
drop policy if exists acre_entries_update on public.acre_entries;
create policy acre_entries_update on public.acre_entries for update to authenticated
  using (public.has_role(array['admin','approver']::user_role[]));

-- Propose a change: parks the edit, does NOT touch the live figures.
create or replace function public.propose_acre_edit(p_id bigint, p_changes jsonb, p_approver uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_entries_access() then
    raise exception 'You do not have access to edit acre entries';
  end if;
  update public.acre_entries
     set pending_changes  = p_changes,
         approval_status  = 'submitted',
         assigned_approver= p_approver,
         submitted_by     = auth.uid(),
         submitted_at     = now(),
         reject_note      = null
   where id = p_id;
  if not found then raise exception 'Acre entry not found'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'edit_proposed', 'acre_entries', p_id::text, 'awaiting approval');
end $$;

-- Approve: apply the parked change to the live row.
create or replace function public.approve_acre_edit(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can approve';
  end if;
  select pending_changes into c from public.acre_entries where id = p_id;
  if c is null then raise exception 'Nothing pending on this entry'; end if;

  update public.acre_entries set
    entry_date   = coalesce((c->>'entry_date')::date,    entry_date),
    location_id  = coalesce(nullif(c->>'location_id','')::uuid, location_id),
    pilot_name   = coalesce(c->>'pilot_name',   pilot_name),
    acres        = coalesce((c->>'acres')::numeric,       acres),
    client_rate  = coalesce((c->>'client_rate')::numeric, client_rate),
    farmer_rate  = coalesce((c->>'farmer_rate')::numeric, farmer_rate),
    rate         = coalesce((c->>'rate')::numeric,        rate),
    amount       = coalesce((c->>'amount')::numeric,      amount),
    crop         = coalesce(c->>'crop',     crop),
    chemical     = coalesce(c->>'chemical', chemical),
    pending_changes = null,
    approval_status = 'approved',
    approved_by     = auth.uid(),
    approved_at     = now()
  where id = p_id;

  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'edit_approved', 'acre_entries', p_id::text, 'change applied');
end $$;

-- Reject: discard the parked change, live figures untouched.
create or replace function public.reject_acre_edit(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can reject';
  end if;
  update public.acre_entries
     set pending_changes = null, approval_status = 'approved',
         reject_note = p_note, approved_by = auth.uid(), approved_at = now()
   where id = p_id;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'edit_rejected', 'acre_entries', p_id::text, p_note);
end $$;

grant execute on function public.propose_acre_edit(bigint, jsonb, uuid) to authenticated;
grant execute on function public.approve_acre_edit(bigint)             to authenticated;
grant execute on function public.reject_acre_edit(bigint, text)        to authenticated;

-- ----------------------------------------------------------- (b) CATALOGUE --
-- Reports whether a catalogue item is in use, so the UI can block deletion.
-- Spares are referenced on documents by line_items->>'_spareId'; services (and
-- spares) also match on the line item description carrying the item name.
create or replace function public.catalogue_usage(p_kind text, p_id uuid, p_name text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_docs int := 0; v_moves int := 0; v_stock numeric := 0; v_sample text;
begin
  select count(*) into v_docs
    from public.documents d
   where exists (
     select 1 from jsonb_array_elements(coalesce(d.line_items, '[]'::jsonb)) li
      where (p_id is not null and (li->>'_spareId') = p_id::text)
         or (coalesce(p_name,'') <> '' and lower(btrim(coalesce(li->>'desc',''))) = lower(btrim(p_name)))
   );

  select string_agg(x.number, ', ') into v_sample from (
    select d.number from public.documents d
     where exists (
       select 1 from jsonb_array_elements(coalesce(d.line_items, '[]'::jsonb)) li
        where (p_id is not null and (li->>'_spareId') = p_id::text)
           or (coalesce(p_name,'') <> '' and lower(btrim(coalesce(li->>'desc',''))) = lower(btrim(p_name)))
     )
     order by d.created_at desc limit 5) x;

  if p_kind = 'spare' then
    select count(*) into v_moves from public.inventory_moves where spare_id = p_id;
    select coalesce(current_stock, 0) into v_stock from public.spare_catalogue where id = p_id;
  end if;

  return jsonb_build_object('docs', v_docs, 'moves', v_moves,
                            'stock', coalesce(v_stock,0), 'sample', coalesce(v_sample,''));
end $$;
grant execute on function public.catalogue_usage(text, uuid, text) to authenticated;
