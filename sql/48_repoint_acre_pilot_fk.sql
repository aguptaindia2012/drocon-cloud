-- ============================================================================
-- 48. THE REAL FIX for acre_entries_pilot_id_fkey
-- ----------------------------------------------------------------------------
-- acre_entries.pilot_id already existed in the original schema (sql/03) as
--     pilot_id uuid references public.authorized_partners(id)
-- so the "add column if not exists" in sql/33 silently did nothing. The foreign
-- key therefore still points at authorized_partners, while the app now supplies
-- ids from the new public.pilots master — every one of which violates it.
--
-- This re-points the constraint at public.pilots, after clearing any legacy
-- value that referred to an authorized_partner (those rows keep pilot_name, so
-- no information is lost).
-- Run this; sql/47 alone could not fix it because it validated the wrong table.
-- ============================================================================

-- 1. See what is about to be cleared (informational — safe to run).
select count(*) as legacy_pilot_links_to_clear
  from public.acre_entries a
 where a.pilot_id is not null
   and not exists (select 1 from public.pilots p where p.id = a.pilot_id);

-- 2. Clear ids that are not in public.pilots (they pointed at authorized_partners).
--    pilot_name is untouched, so the pilot is still named on every row.
update public.acre_entries a
   set pilot_id = null
 where a.pilot_id is not null
   and not exists (select 1 from public.pilots p where p.id = a.pilot_id);

-- 3. Re-point the constraint at the pilots master.
alter table public.acre_entries drop constraint if exists acre_entries_pilot_id_fkey;
alter table public.acre_entries
  add constraint acre_entries_pilot_id_fkey
  foreign key (pilot_id) references public.pilots(id);

-- 4. Verify: this should return the constraint now referencing 'pilots'.
select tc.constraint_name, ccu.table_name as references_table
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
 where tc.table_name = 'acre_entries'
   and tc.constraint_type = 'FOREIGN KEY'
   and tc.constraint_name = 'acre_entries_pilot_id_fkey';
