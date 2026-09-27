-- ============================================================================
-- 116. Reverse lookup: which pilot is an internal login linked to?
-- ----------------------------------------------------------------------------
-- Lets the Employees → Account access panel show/select the pilot an employee
-- login is linked to (companion to pilot_linked_login, which goes the other
-- way). Linking itself still uses admin_link_pilot_login (sql/102).
-- ============================================================================
create or replace function public.login_linked_pilot(p_email text)
returns table(pilot_id uuid, pilot_name text)
language sql stable security definer set search_path = public as $$
  select pr.pilot_id, p.name
    from public.profiles pr
    left join public.pilots p on p.id = pr.pilot_id
   where lower(pr.email) = lower(btrim(p_email))
     and coalesce(pr.is_external,false) = false
   limit 1;
$$;
grant execute on function public.login_linked_pilot(text) to authenticated;
