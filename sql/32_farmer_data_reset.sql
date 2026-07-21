-- ============================================================================
-- 32. Clear mis-entered farmer spray data so the team can re-enter it
-- ----------------------------------------------------------------------------
-- ⚠ THIS DELETES LIVE DATA. Run the steps IN ORDER and read the output of each
--   one before moving to the next. Step 2 makes a full in-database backup, so
--   the delete in Step 3 is reversible via Step 5.
--
-- CONFIRMED SCOPE — two ranges are deleted:
--     (a) everything BEFORE  1 June 2026      (old data, to be re-entered)
--     (b) everything ON/AFTER 22 July 2026    (mis-entry)
--
--   >>> THE ONLY FARMER DATA THAT SURVIVES IS 1 JUNE 2026 -> 21 JULY 2026 <<<
--
--   If that is not what you expect, STOP after Step 1 and do not run Step 3.
--   Affects public.farmer_sprays ONLY. Acre entries, invoices, agreements,
--   inventory, catalogues and every other table are untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — Look before you leap. What goes, and what stays?
-- ---------------------------------------------------------------------------
-- (a) rows to DELETE, split by reason
select 'before 2026-06-01 (old)'   as bucket,
       count(*) as rows_to_delete, min(spray_date) as oldest, max(spray_date) as newest,
       round(sum(acre)::numeric,2) as acres, round(sum(amount)::numeric,2) as amount
  from public.farmer_sprays where spray_date < date '2026-06-01'
union all
select 'on/after 2026-07-22 (mis-entry)',
       count(*), min(spray_date), max(spray_date),
       round(sum(acre)::numeric,2), round(sum(amount)::numeric,2)
  from public.farmer_sprays where spray_date >= date '2026-07-22';

-- (b) rows that SURVIVE — must be 1 Jun 2026 .. 21 Jul 2026 only
select count(*) as rows_kept, min(spray_date) as kept_from, max(spray_date) as kept_to,
       round(sum(acre)::numeric,2) as acres_kept
  from public.farmer_sprays
 where spray_date >= date '2026-06-01' and spray_date < date '2026-07-22';

-- ---------------------------------------------------------------------------
-- STEP 2 — Full backup INTO the database (run this before Step 3).
--          Nothing is deleted here; it only copies the rows aside.
-- ---------------------------------------------------------------------------
create table if not exists public.farmer_sprays_backup_20260722 as
  select * from public.farmer_sprays
   where spray_date <  date '2026-06-01'
      or spray_date >= date '2026-07-22';

-- Confirm this equals the TOTAL of the two delete buckets in Step 1(a).
select count(*) as rows_backed_up from public.farmer_sprays_backup_20260722;

-- ---------------------------------------------------------------------------
-- STEP 3 — The delete. Only run once Steps 1 and 2 both look correct.
-- ---------------------------------------------------------------------------
delete from public.farmer_sprays
 where spray_date <  date '2026-06-01'
    or spray_date >= date '2026-07-22';

-- ---------------------------------------------------------------------------
-- STEP 4 — Verify: should_be_zero must be 0; rows_remaining is your 1 Jun – 21 Jul data.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.farmer_sprays
     where spray_date < date '2026-06-01' or spray_date >= date '2026-07-22') as should_be_zero,
  (select count(*) from public.farmer_sprays) as rows_remaining,
  (select min(spray_date) from public.farmer_sprays) as remaining_from,
  (select max(spray_date) from public.farmer_sprays) as remaining_to;

-- ---------------------------------------------------------------------------
-- STEP 5 — UNDO (only if you need the data back). Restores every backed-up row.
--          'overriding system value' is required because id is an identity col.
-- ---------------------------------------------------------------------------
-- insert into public.farmer_sprays
--   overriding system value
--   select * from public.farmer_sprays_backup_20260722;

-- To restore ONLY the mis-entered range (if you keep the rest deleted):
-- insert into public.farmer_sprays
--   overriding system value
--   select * from public.farmer_sprays_backup_20260722 where spray_date >= date '2026-07-22';

-- ---------------------------------------------------------------------------
-- STEP 6 — Housekeeping: drop the backup once the team has re-entered the data
--          and you are certain you no longer need it. NOT reversible.
-- ---------------------------------------------------------------------------
-- drop table public.farmer_sprays_backup_20260722;
