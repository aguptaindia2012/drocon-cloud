-- ============================================================================
-- DroCon Cloud — Daily Spray Entry two-level approval (#12) + edit gating (#13)
-- A day's sprays are first SUBMITTED as a daily_submissions batch (rows held as
-- JSON). A reviewer/admin APPROVES, which POSTS the batch — expanding it into
-- farmer_sprays + acre_entries via a SECURITY DEFINER function so nothing reaches
-- the dashboards until approved. Approved/posted batches can only be REOPENED by
-- an admin (which deletes the posted rows) — that is the daily "edit needs
-- approval" control. Safe to re-run.
-- ============================================================================

create table if not exists public.daily_submissions (
  id                uuid primary key default gen_random_uuid(),
  entry_date        date not null,
  client_id         uuid,
  client_name       text,
  location_name     text not null,
  state             text,
  district          text,
  rows              jsonb not null default '[]',   -- [{pilot,farmer,phone,village,crop,chemical,acres,crate,frate,gps}]
  total_acres       numeric,
  total_amount      numeric,
  spray_count       integer,
  approval_status   text not null default 'submitted',  -- draft | submitted | approved | rejected
  submitted_by      uuid references public.profiles(id),
  assigned_approver uuid references public.profiles(id),
  submitted_at      timestamptz default now(),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  reject_note       text,
  posted            boolean not null default false,
  posted_source_ids text[],                          -- source_id of every posted child row (for reopen)
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists daily_sub_status   on public.daily_submissions(approval_status);
create index if not exists daily_sub_approver  on public.daily_submissions(assigned_approver);
create index if not exists daily_sub_submitter on public.daily_submissions(submitted_by);

alter table public.daily_submissions enable row level security;
-- read: internal users who are the submitter, the assigned reviewer, an approver/admin,
--       or hold farmer access (the rows carry farmer PII).
drop policy if exists daily_sub_read on public.daily_submissions;
create policy daily_sub_read on public.daily_submissions for select to authenticated
  using (public.is_internal() and (
            submitted_by = auth.uid()
         or assigned_approver = auth.uid()
         or public.has_role(array['admin','approver']::user_role[])
         or public.has_farmer_access()));
-- insert: any internal user files their own submission
drop policy if exists daily_sub_insert on public.daily_submissions;
create policy daily_sub_insert on public.daily_submissions for insert to authenticated
  with check (public.is_internal() and submitted_by = auth.uid());
-- update: submitter may edit only while NOT yet approved/posted; approver/admin always
drop policy if exists daily_sub_update on public.daily_submissions;
create policy daily_sub_update on public.daily_submissions for update to authenticated
  using (public.is_internal() and (
            (submitted_by = auth.uid() and posted = false and approval_status <> 'approved')
         or assigned_approver = auth.uid()
         or public.has_role(array['admin','approver']::user_role[])));
-- delete: submitter while still a draft/rejected (un-posted), or an admin
drop policy if exists daily_sub_delete on public.daily_submissions;
create policy daily_sub_delete on public.daily_submissions for delete to authenticated
  using ((submitted_by = auth.uid() and posted = false and approval_status in ('draft','rejected'))
         or public.has_role(array['admin']::user_role[]));
grant select, insert, update, delete on public.daily_submissions to authenticated;

-- ---------------------------------------------------------------------------
-- post_daily_submission — approve + expand the batch into the live trackers.
-- SECURITY DEFINER: bypasses farmer/acre RLS so the approver need not personally
-- hold farmer access; authorisation is checked explicitly below.
-- ---------------------------------------------------------------------------
create or replace function public.post_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s     public.daily_submissions%rowtype;
  r     jsonb;
  loc   uuid;
  sid   uuid;
  acres numeric; cr numeric; fr numeric; amt numeric;
  sids  text[] := array[]::text[];
begin
  select * into s from public.daily_submissions where id = p_id;
  if s.id is null then raise exception 'Submission not found'; end if;
  if s.posted then raise exception 'This submission is already posted'; end if;

  -- authorisation: admin/approver, or the assigned reviewer
  if not (public.has_role(array['admin','approver']::user_role[])
          or s.assigned_approver = auth.uid()) then
    raise exception 'You are not authorised to approve this daily submission';
  end if;

  -- resolve (or create) the spray location by name
  select id into loc from public.spray_locations where lower(name) = lower(s.location_name) limit 1;
  if loc is null then
    insert into public.spray_locations(name, state, district, rates)
      values (s.location_name, s.state, s.district, '{}'::jsonb) returning id into loc;
  end if;

  for r in select * from jsonb_array_elements(s.rows) loop
    acres := coalesce(nullif(r->>'acres','')::numeric, 0);
    cr    := coalesce(nullif(r->>'crate','')::numeric, 0);
    fr    := coalesce(nullif(r->>'frate','')::numeric, 0);
    -- skip empty rows (no acres and no farmer)
    if acres = 0 and coalesce(trim(r->>'farmer'),'') = '' then continue; end if;
    amt := acres * (cr + fr);
    sid := gen_random_uuid();
    sids := array_append(sids, sid::text);

    insert into public.acre_entries
      (entry_date, location_id, pilot_name, acres, rate, client_rate, farmer_rate, amount, crop, source_id, created_by)
    values
      (s.entry_date, loc, nullif(r->>'pilot',''), acres, nullif(cr+fr,0), nullif(cr,0), nullif(fr,0),
       nullif(amt,0), nullif(r->>'crop',''), sid, s.submitted_by);

    insert into public.farmer_sprays
      (spray_date, pilot_name, client_name, farmer_name, contact_no, village, state, district,
       chemical_company, crop, acre, rate, amount, gps_image_present, source_id, created_by)
    values
      (s.entry_date, nullif(r->>'pilot',''), s.client_name, nullif(r->>'farmer',''), nullif(r->>'phone',''),
       nullif(r->>'village',''), s.state, s.district, nullif(r->>'chemical',''), nullif(r->>'crop',''),
       nullif(acres,0), nullif(cr+fr,0), nullif(amt,0), coalesce((r->>'gps')::boolean,false), sid, s.submitted_by);
  end loop;

  update public.daily_submissions
     set approval_status='approved', approved_by=auth.uid(), approved_at=now(),
         posted=true, posted_source_ids=sids, updated_at=now()
   where id = p_id;
end $$;
grant execute on function public.post_daily_submission(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reopen_daily_submission — admin-only correction: delete the posted child rows
-- and send the batch back to 'submitted' so it can be edited and re-approved.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_daily_submission(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.daily_submissions%rowtype;
begin
  select * into s from public.daily_submissions where id = p_id;
  if s.id is null then raise exception 'Submission not found'; end if;
  if not public.has_role(array['admin']::user_role[]) then
    raise exception 'Only an admin can reopen a posted daily submission';
  end if;
  if s.posted_source_ids is not null and array_length(s.posted_source_ids,1) > 0 then
    delete from public.acre_entries  where source_id = any(s.posted_source_ids);
    delete from public.farmer_sprays where source_id = any(s.posted_source_ids);
  end if;
  update public.daily_submissions
     set approval_status='submitted', posted=false, posted_source_ids=null,
         approved_by=null, approved_at=null, updated_at=now()
   where id = p_id;
end $$;
grant execute on function public.reopen_daily_submission(uuid) to authenticated;

-- ============================================================================
-- Done. Daily Spray Entry now submits for approval; approving posts to the
-- Farmer & Acre trackers; only an admin can reopen a posted day.
-- ============================================================================
