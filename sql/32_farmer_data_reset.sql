-- ============================================================================
-- 32. Clear farmer spray data BEFORE 1 June 2026 so the team can re-enter it
-- ----------------------------------------------------------------------------
-- ⚠ THIS DELETES LIVE DATA. Run the steps IN ORDER and read the output of each
--   one before moving to the next. Step 2 makes a full in-database backup, so
--   the delete in Step 3 is reversible via Step 5.
--
-- CUT-OFF (confirmed): rows with spray_date EARLIER THAN 1 June 2026 are deleted.
--   KEEP   : everything on/after 2026-06-01
--   DELETE : all farmer history before 2026-06-01
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — Look before you leap. How many rows, and over what date range?
-- ---------------------------------------------------------------------------
select count(*)                        as rows_to_delete,
       min(spray_date)                 as oldest,
       max(spray_date)                 as newest,
       count(distinct pilot_name)      as pilots,
       round(sum(acre)::numeric, 2)    as total_acres,
       round(sum(amount)::numeric, 2)  as total_amount
  from public.farmer_sprays
 where spray_date < date '2026-06-01';

-- Sanity check — this is what SURVIVES (should be your 1 June onward data):
select count(*) as rows_kept, min(spray_date) as kept_from, max(spray_date) as kept_to
  from public.farmer_sprays
 where spray_date >= date '2026-06-01';

-- ---------------------------------------------------------------------------
-- STEP 2 — Full backup INTO the database (run this before Step 3).
--          Nothing is deleted here; it only copies the rows aside.
-- ---------------------------------------------------------------------------
create table if not exists public.farmer_sprays_backup_pre20260601 as
  select * from public.farmer_sprays
   where spray_date < date '2026-06-01';

-- Confirm the backup matches rows_to_delete from Step 1 before continuing.
select count(*) as rows_backed_up from public.farmer_sprays_backup_pre20260601;

-- ---------------------------------------------------------------------------
-- STEP 3 — The delete. Only run this once Steps 1 and 2 both look correct.
-- ---------------------------------------------------------------------------
delete from public.farmer_sprays
 where spray_date < date '2026-06-01';

-- ---------------------------------------------------------------------------
-- STEP 4 — Verify: the first number must be 0, the second is your kept data.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.farmer_sprays where spray_date <  date '2026-06-01') as should_be_zero,
  (select count(*) from public.farmer_sprays where spray_date >= date '2026-06-01') as rows_remaining;

-- ---------------------------------------------------------------------------
-- STEP 5 — UNDO (only if you need the data back). Restores every backed-up row.
--          'overriding system value' is required because id is an identity col.
-- ---------------------------------------------------------------------------
-- insert into public.farmer_sprays
--   overriding system value
--   select * from public.farmer_sprays_backup_pre20260601;

-- ---------------------------------------------------------------------------
-- STEP 6 — Housekeeping: drop the backup once the team has re-entered the data
--          and you are certain you no longer need it. NOT reversible.
-- ---------------------------------------------------------------------------
-- drop table public.farmer_sprays_backup_pre20260601;
