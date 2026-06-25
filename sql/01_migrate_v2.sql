-- ============================================================================
-- DroCon Bharat Agreement Studio — Cloud, migration v2
-- Adds: separation of duties, two-level approval, and notifications.
-- Safe to run once on your existing project (SQL Editor → paste → Run).
-- Click through the "destructive operations" notice — it only changes YOUR schema.
-- ============================================================================

-- 1) Allow a new "recommended" status. We switch status to TEXT (+ check) so we
--    can evolve states without enum-migration friction.
alter table public.agreements alter column status drop default;
alter table public.agreements alter column status type text using status::text;
alter table public.agreements alter column status set default 'draft';
do $$ begin
  alter table public.agreements add constraint agreements_status_chk
    check (status in ('draft','in_review','recommended','approved','rejected','executed'));
exception when duplicate_object then null; end $$;

-- 2) Notifications -----------------------------------------------------------
create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  agreement_id uuid references public.agreements(id) on delete cascade,
  type         text,
  message      text not null,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.notifications enable row level security;
create index if not exists notif_user_idx on public.notifications(user_id, is_read, created_at desc);

drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, update on public.notifications to authenticated;

-- helper: write a notification (used inside the SECURITY DEFINER RPCs below)
create or replace function public.notify(p_user uuid, p_ag uuid, p_type text, p_msg text)
returns void language sql security definer set search_path=public as $$
  insert into public.notifications(user_id, agreement_id, type, message)
  select p_user, p_ag, p_type, p_msg where p_user is not null;
$$;

-- ============================================================================
-- 3) Workflow RPCs. All rules live here, enforced by the database.
-- ============================================================================

-- Submit a draft for review (preparer only)
create or replace function public.submit_for_review(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; r record;
begin
  select * into ag from public.agreements where id = p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  if ag.created_by <> auth.uid() then raise exception 'Only the preparer can submit this agreement'; end if;
  if ag.status not in ('draft','rejected') then raise exception 'Only a draft can be submitted'; end if;

  update public.agreements set status='in_review' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'submitted','agreement',p_id::text, coalesce(p_note,'Submitted for review'));

  -- notify the assigned approver, or (if none) every approver/admin
  if ag.assigned_approver is not null then
    perform public.notify(ag.assigned_approver, p_id, 'review', 'An agreement "'||ag.title||'" is awaiting your review.');
  else
    for r in select id from public.profiles where role in ('approver','admin') and id <> auth.uid() loop
      perform public.notify(r.id, p_id, 'review', 'An agreement "'||ag.title||'" is awaiting review.');
    end loop;
  end if;
end $$;

-- Approve. Admin = final approval. Non-admin approver = "recommend" (needs admin).
create or replace function public.approve_agreement(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role; r record;
begin
  select * into ag from public.agreements where id=p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'You are not authorised to approve'; end if;
  -- separation of duties: a preparer cannot approve their own work unless they are an admin
  if ag.created_by = auth.uid() and v_role <> 'admin' then
    raise exception 'The preparer cannot approve their own agreement';
  end if;

  if v_role = 'admin' and ag.status in ('in_review','recommended') then
    update public.agreements set status='approved' where id=p_id;
    insert into public.audit_log(actor,action,entity,entity_id,note)
      values (auth.uid(),'approved','agreement',p_id::text, coalesce(p_note,'Approved (final)'));
    perform public.notify(ag.created_by, p_id, 'approved', 'Your agreement "'||ag.title||'" has been approved.');
    -- also tell any approver who recommended it
    for r in select distinct actor from public.audit_log where entity='agreement' and entity_id=p_id::text and action='recommended' loop
      perform public.notify(r.actor, p_id, 'approved', 'The agreement "'||ag.title||'" you reviewed has been approved by an admin.');
    end loop;

  elsif v_role = 'approver' and ag.status = 'in_review' then
    update public.agreements set status='recommended' where id=p_id;
    insert into public.audit_log(actor,action,entity,entity_id,note)
      values (auth.uid(),'recommended','agreement',p_id::text, coalesce(p_note,'Recommended — awaiting admin approval'));
    -- notify all admins (they must finalise) and the preparer (status update)
    for r in select id from public.profiles where role='admin' loop
      perform public.notify(r.id, p_id, 'final_needed', 'Agreement "'||ag.title||'" was recommended and needs your final approval.');
    end loop;
    perform public.notify(ag.created_by, p_id, 'recommended', 'Your agreement "'||ag.title||'" was reviewed and recommended; awaiting admin approval.');

  elsif v_role = 'approver' and ag.status = 'recommended' then
    raise exception 'Already recommended — awaiting an admin for final approval';
  else
    raise exception 'Cannot approve from the current status (%).', ag.status;
  end if;
end $$;

-- Reject (approver/admin; not your own work unless admin)
create or replace function public.reject_agreement(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role; r record;
begin
  select * into ag from public.agreements where id=p_id;
  if ag.id is null then raise exception 'Agreement not found'; end if;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'You are not authorised to reject'; end if;
  if ag.created_by = auth.uid() and v_role <> 'admin' then raise exception 'The preparer cannot reject their own agreement'; end if;
  if ag.status not in ('in_review','recommended') then raise exception 'Only an item under review can be rejected'; end if;

  update public.agreements set status='rejected' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'rejected','agreement',p_id::text, coalesce(p_note,'Rejected'));
  perform public.notify(ag.created_by, p_id, 'rejected', 'Your agreement "'||ag.title||'" was returned with changes requested.'||case when p_note is not null then ' Note: '||p_note else '' end);
  for r in select distinct actor from public.audit_log where entity='agreement' and entity_id=p_id::text and action='recommended' loop
    perform public.notify(r.actor, p_id, 'rejected', 'The agreement "'||ag.title||'" you recommended was rejected.');
  end loop;
end $$;

-- Mark executed (signed) — approver/admin, after final approval
create or replace function public.mark_executed(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare ag public.agreements; v_role user_role;
begin
  select * into ag from public.agreements where id=p_id;
  v_role := public.my_role();
  if v_role not in ('approver','admin') then raise exception 'Not authorised'; end if;
  if ag.status <> 'approved' then raise exception 'Only an approved agreement can be marked executed'; end if;
  update public.agreements set status='executed' where id=p_id;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'executed','agreement',p_id::text, coalesce(p_note,'Marked executed (signed)'));
  perform public.notify(ag.created_by, p_id, 'executed', 'Your agreement "'||ag.title||'" has been marked executed.');
end $$;

grant execute on function public.submit_for_review(uuid,text) to authenticated;
grant execute on function public.approve_agreement(uuid,text) to authenticated;
grant execute on function public.reject_agreement(uuid,text) to authenticated;
grant execute on function public.mark_executed(uuid,text) to authenticated;
grant execute on function public.notify(uuid,uuid,text,text) to authenticated;

-- ============================================================================
-- Done. Statuses now flow:
--   draft → in_review → (recommended) → approved → executed
--                         ↑ non-admin approver        ↑ admin only
--   any review step → rejected → back to draft owner
-- Separation of duties and "non-admin approvals need an admin" are enforced above.
-- ============================================================================
