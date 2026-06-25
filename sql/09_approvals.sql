-- ============================================================================
-- DroCon Cloud — approval workflow (Phase 4)
-- Adds a Draft -> Submitted -> Approved/Rejected approval track to clients,
-- vendors, documents (invoice/CN/quotation/PO) and bom_designs. Kept SEPARATE
-- from any existing lifecycle/payment status. Each submission is assigned to a
-- reviewer; the consolidated Review/Approvals tab shows each user only what is
-- assigned to them. (Agreements keep their own status workflow.)
-- Safe to re-run.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['clients','vendors','documents','bom_designs'] loop
    execute format('alter table public.%I add column if not exists approval_status text not null default ''draft'';', t);
    execute format('alter table public.%I add column if not exists submitted_by uuid references public.profiles(id);', t);
    execute format('alter table public.%I add column if not exists submitted_at timestamptz;', t);
    execute format('alter table public.%I add column if not exists assigned_approver uuid references public.profiles(id);', t);
    execute format('alter table public.%I add column if not exists approved_by uuid references public.profiles(id);', t);
    execute format('alter table public.%I add column if not exists approved_at timestamptz;', t);
    execute format('alter table public.%I add column if not exists reject_note text;', t);
    execute format('create index if not exists %I_approval_idx on public.%I(approval_status, assigned_approver);', t, t);
  end loop;
end $$;
