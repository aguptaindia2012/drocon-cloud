-- ============================================================================
-- 29. Contract numbers on agreements + let the team correct old spray entries
-- ----------------------------------------------------------------------------
-- (1) A contract / agreement number, assigned AFTER approval & signature and
--     BEFORE the agreement is marked executed. Shown on the Agreements list.
-- (2) Old Acre / Farmer rows imported from CSV were wrong. Allow anyone granted
--     the "Entries" tool (not just Farmer/Acre) to read & correct those rows,
--     so an admin can delegate the clean-up without opening farmer contacts.
-- Run this whole file in Supabase → SQL Editor.
-- ============================================================================

-- ---- (1) Contract number ----------------------------------------------------
alter table public.agreements add column if not exists agreement_no text;

-- Optional: keep assigned numbers unique (nulls allowed, so drafts are fine).
create unique index if not exists agreements_agreement_no_uidx
  on public.agreements (agreement_no) where agreement_no is not null;

-- Set / change the contract number. Only an approver/admin, and only once the
-- agreement has cleared approval (status approved or executed).
create or replace function public.set_agreement_no(p_id uuid, p_no text)
returns void language plpgsql security definer set search_path = public as $$
declare cur record;
begin
  if not public.has_role(array['admin','approver']::user_role[]) then
    raise exception 'Only an approver or admin can assign a contract number';
  end if;
  select status into cur from public.agreements where id = p_id;
  if not found then raise exception 'Agreement not found'; end if;
  if cur.status not in ('approved','executed') then
    raise exception 'Assign the contract number only after the agreement is approved';
  end if;
  update public.agreements
     set agreement_no = nullif(btrim(p_no),''), updated_at = now()
   where id = p_id;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'contract_no_set', 'agreement', p_id::text, p_no);
end $$;
grant execute on function public.set_agreement_no(uuid, text) to authenticated;

-- ---- (2) Entries-grant access to correct old spray data ---------------------
create or replace function public.has_entries_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists (select 1 from public.app_permissions p
                 where p.user_id = auth.uid()
                   and p.tool_key in ('entries','farmer','acre'));
$$;
grant execute on function public.has_entries_access() to authenticated;

-- farmer_sprays: allow the Entries grant to read + correct rows (phone stays
-- masked in the UI unless the user also holds the View-contacts capability).
drop policy if exists farmer_sprays_read   on public.farmer_sprays;
drop policy if exists farmer_sprays_insert on public.farmer_sprays;
drop policy if exists farmer_sprays_update on public.farmer_sprays;
create policy farmer_sprays_read   on public.farmer_sprays for select to authenticated
  using (public.has_farmer_access() or public.has_entries_access());
create policy farmer_sprays_insert on public.farmer_sprays for insert to authenticated
  with check (public.has_farmer_access() or public.has_entries_access());
create policy farmer_sprays_update on public.farmer_sprays for update to authenticated
  using (public.has_farmer_access() or public.has_entries_access());

-- acre_entries: make its update/delete gate explicit (Entries grant or admin).
alter table public.acre_entries enable row level security;
drop policy if exists acre_entries_update on public.acre_entries;
drop policy if exists acre_entries_delete on public.acre_entries;
create policy acre_entries_update on public.acre_entries for update to authenticated
  using (public.has_entries_access() or public.is_internal());
create policy acre_entries_delete on public.acre_entries for delete to authenticated
  using (public.has_role(array['admin']::user_role[]) or public.has_entries_access());
