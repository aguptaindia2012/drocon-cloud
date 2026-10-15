-- ============================================================================
-- 125. Location setup — RLS lockdown (Phase 3, hard enforcement)
-- ----------------------------------------------------------------------------
-- Make the maker-checker unbypassable: NO ONE (admins included) can write the
-- Location tables directly. Every create / edit / rate / crop / pilot change must
-- go through the change-request RPCs (submit → approve), which are SECURITY
-- DEFINER and therefore bypass these policies. Reads stay open to the team.
--
-- Unaffected (all SECURITY DEFINER, so they still work):
--   approve_location_change, set_location_lock,
--   assign_pilot_location, pause/reactivate/close_pilot_assignment.
--
-- Exemption: the acre CSV bulk-import creates missing locations in one shot via
-- the admin-only RPC below (a data-migration tool), not per-location approval.
-- Idempotent.
-- ============================================================================

-- ---- spray_locations: no direct insert / update / delete -------------------
drop policy if exists spray_locations_insert on public.spray_locations;
create policy spray_locations_insert on public.spray_locations for insert to authenticated with check (false);
drop policy if exists spray_locations_update on public.spray_locations;
create policy spray_locations_update on public.spray_locations for update to authenticated using (false);
drop policy if exists spray_locations_delete on public.spray_locations;
create policy spray_locations_delete on public.spray_locations for delete to authenticated using (false);

-- ---- location_crop_rates: no direct insert / update / delete ---------------
drop policy if exists location_crop_rates_insert on public.location_crop_rates;
create policy location_crop_rates_insert on public.location_crop_rates for insert to authenticated with check (false);
drop policy if exists location_crop_rates_update on public.location_crop_rates;
create policy location_crop_rates_update on public.location_crop_rates for update to authenticated using (false);
drop policy if exists location_crop_rates_delete on public.location_crop_rates;
create policy location_crop_rates_delete on public.location_crop_rates for delete to authenticated using (false);

-- ---- pilot_assignments: no direct insert / update (RPCs only) --------------
-- (delete stays admin-only as an escape hatch; the UI never deletes.)
drop policy if exists pa_write  on public.pilot_assignments;
create policy pa_write  on public.pilot_assignments for insert to authenticated with check (false);
drop policy if exists pa_update on public.pilot_assignments;
create policy pa_update on public.pilot_assignments for update to authenticated using (false);

-- ---------------------------------------------------------------------------
-- admin_bulk_create_locations — the acre CSV import's only way to create the
-- locations a sheet references. Admin-only, SECURITY DEFINER. Returns the new
-- {name,id} pairs so the import can attach its acre rows.
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_create_locations(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec jsonb; new_id uuid; out jsonb := '[]'::jsonb;
begin
  if not public.has_role(array['admin']::user_role[]) then
    raise exception 'Only an admin can bulk-create locations (CSV import).'; end if;
  for rec in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) as t(value) loop
    insert into public.spray_locations(name, state, district, rates, created_by)
      values (rec->>'name', nullif(rec->>'state',''), nullif(rec->>'district',''),
              coalesce(rec->'rates','{}'::jsonb), auth.uid())
      returning id into new_id;
    out := out || jsonb_build_array(jsonb_build_object('name', rec->>'name', 'id', new_id));
  end loop;
  return out;
end $$;
grant execute on function public.admin_bulk_create_locations(jsonb) to authenticated;
