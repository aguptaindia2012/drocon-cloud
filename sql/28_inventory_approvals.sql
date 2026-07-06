-- ============================================================================
-- DroCon Cloud — Inventory entries: edit-requires-approval (change-on-approve)
-- Creating a stock entry is free. EDITING an existing entry does NOT take effect
-- until a designated approver/admin approves it: the proposed values are parked
-- in pending_changes and only written to the live row (and stock) on approval.
-- Enforced by RLS (non-admins cannot UPDATE directly) + SECURITY DEFINER RPCs.
-- Safe to re-run.
-- ============================================================================

alter table public.inventory_moves add column if not exists purchase_invoice_no text;
alter table public.inventory_moves add column if not exists sales_invoice_no    text;
alter table public.inventory_moves add column if not exists approval_status     text not null default 'approved'; -- approved | submitted
alter table public.inventory_moves add column if not exists assigned_approver   uuid references public.profiles(id);
alter table public.inventory_moves add column if not exists submitted_by        uuid references public.profiles(id);
alter table public.inventory_moves add column if not exists submitted_at        timestamptz;
alter table public.inventory_moves add column if not exists approved_by         uuid references public.profiles(id);
alter table public.inventory_moves add column if not exists approved_at         timestamptz;
alter table public.inventory_moves add column if not exists reject_note         text;
alter table public.inventory_moves add column if not exists pending_changes     jsonb;

-- Stock trigger now also handles UPDATE: reverse the OLD effect, apply the NEW
-- effect (net-zero when qty/direction/spare are unchanged, e.g. metadata-only or
-- pending-only edits). So an approved edit re-syncs stock on the same row id.
create or replace function public.apply_inventory_move()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.spare_catalogue
      set current_stock = coalesce(current_stock,0) + (case when new.direction='in' then new.qty else -new.qty end),
          updated_at = now()
      where id = new.spare_id;
  elsif (tg_op = 'DELETE') then
    update public.spare_catalogue
      set current_stock = coalesce(current_stock,0) - (case when old.direction='in' then old.qty else -old.qty end),
          updated_at = now()
      where id = old.spare_id;
  elsif (tg_op = 'UPDATE') then
    update public.spare_catalogue
      set current_stock = coalesce(current_stock,0) - (case when old.direction='in' then old.qty else -old.qty end),
          updated_at = now()
      where id = old.spare_id;
    update public.spare_catalogue
      set current_stock = coalesce(current_stock,0) + (case when new.direction='in' then new.qty else -new.qty end),
          updated_at = now()
      where id = new.spare_id;
  end if;
  return null;
end $$;
drop trigger if exists inv_move_apply on public.inventory_moves;
create trigger inv_move_apply after insert or delete or update on public.inventory_moves
  for each row execute function public.apply_inventory_move();

-- New inserts are always "approved" (first entry is free of approvals),
-- regardless of what the client sends.
create or replace function public.inventory_move_new_defaults()
returns trigger language plpgsql as $$
begin
  new.approval_status := 'approved';
  new.pending_changes := null;
  new.submitted_by := null; new.submitted_at := null; new.assigned_approver := null;
  return new;
end $$;
drop trigger if exists inv_move_defaults on public.inventory_moves;
create trigger inv_move_defaults before insert on public.inventory_moves
  for each row execute function public.inventory_move_new_defaults();

-- RLS: direct UPDATE is admin/approver only. Everyone else proposes via the RPC.
drop policy if exists inventory_moves_update on public.inventory_moves;
create policy inventory_moves_update on public.inventory_moves for update to authenticated
  using (public.has_role(array['admin','approver']::user_role[]));

-- ---------------------------------------------------------------------------
-- propose_inventory_edit — a non-admin parks the proposed values; nothing on the
-- live row (or stock) changes until approved. SECURITY DEFINER bypasses the
-- tightened UPDATE policy but only writes the pending fields.
-- ---------------------------------------------------------------------------
create or replace function public.propose_inventory_edit(p_id bigint, p_changes jsonb, p_approver uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.inventory_moves%rowtype;
begin
  select * into m from public.inventory_moves where id = p_id;
  if m.id is null then raise exception 'Inventory entry not found'; end if;
  if not public.is_internal() then raise exception 'You are not authorised to propose edits'; end if;
  update public.inventory_moves
     set pending_changes = p_changes,
         approval_status = 'submitted',
         submitted_by = auth.uid(), submitted_at = now(),
         assigned_approver = p_approver, reject_note = null
   where id = p_id;
end $$;
grant execute on function public.propose_inventory_edit(bigint, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_inventory_edit — apply the parked change to the live row (the stock
-- trigger re-syncs), then mark approved and clear the pending payload.
-- ---------------------------------------------------------------------------
create or replace function public.approve_inventory_edit(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare m public.inventory_moves%rowtype; c jsonb;
begin
  select * into m from public.inventory_moves where id = p_id;
  if m.id is null then raise exception 'Inventory entry not found'; end if;
  if not (public.has_role(array['admin','approver']::user_role[]) or m.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to approve this edit'; end if;
  c := coalesce(m.pending_changes, '{}'::jsonb);
  update public.inventory_moves set
    spare_id            = coalesce(nullif(c->>'spare_id','')::uuid, spare_id),
    qty                 = coalesce(nullif(c->>'qty','')::numeric, qty),
    direction           = coalesce(nullif(c->>'direction',''), direction),
    reason              = case when c ? 'reason'              then c->>'reason'              else reason end,
    moved_on            = coalesce(nullif(c->>'moved_on','')::date, moved_on),
    purchase_invoice_no = case when c ? 'purchase_invoice_no' then c->>'purchase_invoice_no' else purchase_invoice_no end,
    sales_invoice_no    = case when c ? 'sales_invoice_no'    then c->>'sales_invoice_no'    else sales_invoice_no end,
    approval_status = 'approved', approved_by = auth.uid(), approved_at = now(),
    pending_changes = null, reject_note = null
   where id = p_id;
end $$;
grant execute on function public.approve_inventory_edit(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- reject_inventory_edit — discard the parked change; the live row was never
-- touched, so it simply returns to 'approved' with a rejection note.
-- ---------------------------------------------------------------------------
create or replace function public.reject_inventory_edit(p_id bigint, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.inventory_moves%rowtype;
begin
  select * into m from public.inventory_moves where id = p_id;
  if m.id is null then raise exception 'Inventory entry not found'; end if;
  if not (public.has_role(array['admin','approver']::user_role[]) or m.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to reject this edit'; end if;
  update public.inventory_moves
     set pending_changes = null, approval_status = 'approved',
         reject_note = p_note, approved_by = auth.uid(), approved_at = now()
   where id = p_id;
end $$;
grant execute on function public.reject_inventory_edit(bigint, text) to authenticated;

-- ============================================================================
-- Done. Inventory entries: create freely; edits are held for approval and only
-- take effect (including stock) once the designated approver/admin approves.
-- ============================================================================
