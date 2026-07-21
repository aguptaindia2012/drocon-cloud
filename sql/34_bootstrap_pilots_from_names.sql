-- ============================================================================
-- 34. Bootstrap the Pilots list from the pilot names already in the data
-- ----------------------------------------------------------------------------
-- Creates one pilot record per DISTINCT existing pilot_name (case-insensitive)
-- from acre_entries and farmer_sprays, so the team has something to select from
-- immediately. These are marked source='imported' and have NO vendor yet — the
-- team edits each one to set the vendor and delete/merge duplicates.
--
-- Old rows are NOT touched: acre_entries.pilot_id stays null and the historic
-- pilot_name text is preserved, so no existing data changes.
-- Safe to re-run (it skips names that already exist).
-- ============================================================================

-- Imported pilots have no employer yet, so vendor becomes optional.
-- New pilots created in the app still require a vendor (enforced in the UI).
alter table public.pilots alter column vendor_id drop not null;
alter table public.pilots add column if not exists source text not null default 'manual';

-- Stop duplicate imported names sneaking in (only applies while vendor is null,
-- so two different vendors may still each employ a pilot with the same name).
create unique index if not exists pilots_imported_name_uidx
  on public.pilots (lower(btrim(name))) where vendor_id is null;

-- ---- the import -----------------------------------------------------------
with names as (
  select distinct btrim(pilot_name) as nm
    from public.acre_entries
   where coalesce(btrim(pilot_name),'') <> ''
  union
  select distinct btrim(pilot_name)
    from public.farmer_sprays
   where coalesce(btrim(pilot_name),'') <> ''
), dedup as (
  -- one row per name, case-insensitively (keeps the first spelling seen)
  select distinct on (lower(nm)) nm from names order by lower(nm), nm
)
insert into public.pilots (vendor_id, name, source, is_active, notes)
select null, d.nm, 'imported', true,
       'Imported from existing entries — set the vendor, and delete any duplicate spellings.'
  from dedup d
 where not exists (
   select 1 from public.pilots p where lower(btrim(p.name)) = lower(d.nm)
 );

-- ---- how many did we create? ----------------------------------------------
select count(*) filter (where source='imported')                              as imported_pilots,
       count(*) filter (where source='imported' and vendor_id is null)        as still_need_a_vendor,
       count(*)                                                               as total_pilots
  from public.pilots;

-- ---- let the team clean up duplicates -------------------------------------
-- A pilot may only be deleted when nothing points at it: no location
-- assignment and no acre entry linked by pilot_id. Historic text names are
-- unaffected, so deleting a duplicate never touches past data.
create or replace function public.delete_pilot(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_assign int; v_acres int;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  select count(*) into v_assign from public.pilot_assignments where pilot_id = p_id;
  select count(*) into v_acres  from public.acre_entries      where pilot_id = p_id;
  if v_assign > 0 then
    raise exception 'Cannot delete: this pilot has % location assignment(s). Close and remove them first.', v_assign;
  end if;
  if v_acres > 0 then
    raise exception 'Cannot delete: % acre entr(ies) are linked to this pilot.', v_acres;
  end if;
  delete from public.pilots where id = p_id;
  if not found then raise exception 'Pilot not found'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'deleted', 'pilots', p_id::text, 'duplicate cleanup');
end $$;
grant execute on function public.delete_pilot(uuid) to authenticated;
