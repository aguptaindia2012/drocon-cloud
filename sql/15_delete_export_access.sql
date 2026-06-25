-- ============================================================================
-- DroCon Cloud — delete access control
-- Admins can delete anything; admins can also GRANT delete rights to others via
-- the 'can_delete' per-tool permission. Deletions are recorded in audit_log by
-- the app. (Export control is enforced in the UI — see app.js capabilities.)
-- Safe to re-run.
-- ============================================================================
create or replace function public.has_delete_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin']::user_role[])
      or exists (select 1 from public.app_permissions p
                 where p.user_id = auth.uid() and p.tool_key = 'can_delete');
$$;

-- main business tables: deletable by a delete-access holder or the row's creator
do $$ declare t text;
begin
  foreach t in array array['clients','vendors','authorized_partners','documents',
                           'bom_designs','potential_orders','acre_entries','spray_locations',
                           'service_catalogue','spare_catalogue'] loop
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated
                    using (public.has_delete_access());', t, t);
  end loop;
end $$;
-- (HR + farmer deletes remain restricted to admin/creator with their own access gates.)
