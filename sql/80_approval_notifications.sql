-- ============================================================================
-- 80. In-app notifications on approval requests + decisions  (feature #2)
-- ----------------------------------------------------------------------------
-- When any approvable record is SUBMITTED, alert the approver(s) via the bell.
-- When it is APPROVED / REJECTED, tell the person who created it.
-- Generic trigger — reads the row as jsonb so it works across every approvable
-- table without per-table code. Degrades gracefully: a table missing
-- created_by / assigned_approver simply skips that branch.
-- Agreements keep their own richer flow (sql/01) and are NOT retriggered here.
-- Additive & idempotent.
-- ============================================================================

-- deep-link target for a notification (which screen to open on click)
alter table public.notifications add column if not exists link text;

-- write a notification with an optional deep-link (bypasses RLS as definer)
create or replace function public.notify_link(p_user uuid, p_type text, p_msg text, p_link text)
returns void language sql security definer set search_path=public as $$
  insert into public.notifications(user_id, type, message, link)
  select p_user, p_type, p_msg, p_link where p_user is not null;
$$;

create or replace function public.notify_on_approval() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  j jsonb := to_jsonb(NEW);
  oldst text := case when TG_OP='UPDATE' then (to_jsonb(OLD))->>'approval_status' else null end;
  newst text := j->>'approval_status';
  label text := coalesce(nullif(j->>'title',''), nullif(j->>'name',''), nullif(j->>'firm_name',''),
                         nullif(j->>'doc_no',''), nullif(j->>'invoice_no',''), nullif(j->>'ref_no',''),
                         nullif(j->>'client_ref',''), nullif(j->>'ref',''), 'record');
  creator  uuid := nullif(j->>'created_by','')::uuid;
  assignee uuid := nullif(j->>'assigned_approver','')::uuid;
  what text := replace(TG_TABLE_NAME,'_',' ');
  actor uuid := auth.uid();
  r record;
begin
  -- submitted for approval -> alert approver(s)
  if newst='submitted' and (oldst is distinct from 'submitted') then
    if assignee is not null then
      perform public.notify_link(assignee,'approval','Approval needed — '||what||': '||label||'.','reviews');
    else
      for r in select id from public.profiles
               where role in ('approver','admin') and coalesce(is_external,false)=false
                 and id is distinct from actor loop
        perform public.notify_link(r.id,'approval','Approval needed — '||what||': '||label||'.','reviews');
      end loop;
    end if;
  end if;

  -- decided -> tell the creator (unless they decided it themselves)
  if newst in ('approved','rejected') and (oldst is distinct from newst)
     and creator is not null and creator is distinct from actor then
    perform public.notify_link(creator,'approval',
      'Your '||what||' "'||label||'" was '||newst||'.', null);
  end if;

  return NEW;
end $$;

-- attach the trigger to every approvable table that actually has approval_status
do $$
declare t text;
  tables text[] := array['clients','vendors','documents','bom_designs',
                         'daily_submissions','inventory_moves','acre_entries'];
begin
  foreach t in array tables loop
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name=t and column_name='approval_status') then
      execute format('drop trigger if exists trg_notify_approval on public.%I', t);
      execute format($f$create trigger trg_notify_approval
        after insert or update of approval_status on public.%I
        for each row execute function public.notify_on_approval()$f$, t);
    end if;
  end loop;
end $$;

grant execute on function public.notify_link(uuid,text,text,text) to authenticated;
