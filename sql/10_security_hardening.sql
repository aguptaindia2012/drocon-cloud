-- ============================================================================
-- DroCon Cloud — data-security hardening (PII)
-- Enforces, IN THE DATABASE (not just the UI), that sensitive personal data is
-- only readable/writable by people the admin has actually granted access to.
-- Without this, any signed-in user could read e.g. salaries or bank details
-- directly through the API. Run AFTER 03/07/09. Safe to re-run.
--
-- Model: access to a sensitive table = admin OR holding the matching per-tool
-- permission (app_permissions). This makes the per-tool grants a real security
-- boundary, consistent with the in-app "Team & Access" screen.
-- ============================================================================

-- HR / payroll access: admin or anyone granted any HR tool
create or replace function public.has_hr_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists (select 1 from public.app_permissions p
                 where p.user_id = auth.uid()
                   and p.tool_key in ('hr_salary','hr_employees','hr_records'));
$$;

-- Farmer-data access (names + phone numbers): admin or the Farmer Tracker grant
create or replace function public.has_farmer_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists (select 1 from public.app_permissions p
                 where p.user_id = auth.uid() and p.tool_key = 'farmer');
$$;

-- ---- Lock down HR tables (salaries, bank details, payroll, ledger) ----------
do $$
declare t text;
begin
  foreach t in array array['employees','salary_runs','salary_payments','accounting_entries'] loop
    -- drop the permissive team-wide policies created earlier
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    -- recreate, gated to HR access
    execute format('create policy %I_read   on public.%I for select to authenticated using (public.has_hr_access());', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.has_hr_access());', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.has_hr_access());', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.has_role(array[''admin'']::user_role[]));', t, t);
  end loop;
end $$;

-- ---- Lock down farmer data (phone numbers, names, villages) ------------------
drop policy if exists farmer_sprays_read   on public.farmer_sprays;
drop policy if exists farmer_sprays_insert on public.farmer_sprays;
drop policy if exists farmer_sprays_update on public.farmer_sprays;
drop policy if exists farmer_sprays_delete on public.farmer_sprays;
create policy farmer_sprays_read   on public.farmer_sprays for select to authenticated using (public.has_farmer_access());
create policy farmer_sprays_insert on public.farmer_sprays for insert to authenticated with check (public.has_farmer_access());
create policy farmer_sprays_update on public.farmer_sprays for update to authenticated using (public.has_farmer_access());
create policy farmer_sprays_delete on public.farmer_sprays for delete to authenticated
  using (public.has_role(array['admin']::user_role[]) or created_by = auth.uid());

-- ============================================================================
-- Notes:
--  • Admin always has access (bootstrap + oversight).
--  • Other tables (clients, vendors, documents, orders, partners, acre) remain
--    team-readable by design (small-team operations). To restrict any of them
--    the same way, copy the pattern above with the relevant tool_key.
--  • Column-level secrets (e.g. employees.bank_details) are protected by the
--    row-level gate above and encrypted at rest by Supabase.
-- ============================================================================
