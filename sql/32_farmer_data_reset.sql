-- ============================================================================
-- 32. Clear farmer spray data BEFORE the cut-off so the team can re-enter it
-- ----------------------------------------------------------------------------
-- ⚠ THIS DELETES LIVE DATA. Run the steps IN ORDER and read the output of each
--   one before moving to the next. Step 2 makes a full in-database backup, so
--   the delete in Step 3 is reversible via Step 5.
--
-- CUT-OFF: rows with spray_date EARLIER THAN 9 July 2026 are affected.
--   Change the date in EVERY step below if you meant a different year/day.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — Look before you leap. How many rows, and over what date range?
-- ---------------------------------------------------------------------------
select count(*)            as rows_to_delete,
       min(spray_date)     as oldest,
       max(spray_date)     as newest,
       count(distinct pilot_name) as pilots,
       round(sum(acre)::numeric, 2)   as total_acres,
       round(sum(amount)::numeric, 2) as total_amount
  from public.farmer_sprays
 where spray_date < date '2026-07-09';

-- ---------------------------------------------------------------------------
-- STEP 2 — Full backup INTO the database (run this before Step 3).
--          Nothing is deleted here; it only copies the rows aside.
-- ---------------------------------------------------------------------------
create table if not exists public.farmer_sprays_backup_20260709 as
  select * from public.farmer_sprays
   where spray_date < date '2026-07-09';

-- Confirm the backup matches the count from Step 1 before continuing.
select count(*) as rows_backed_up from public.farmer_sprays_backup_20260709;

-- ---------------------------------------------------------------------------
-- STEP 3 — The delete. Only run this once Steps 1 and 2 both look correct.
-- ---------------------------------------------------------------------------
delete from public.farmer_sprays
 where spray_date < date '2026-07-09';

-- ---------------------------------------------------------------------------
-- STEP 4 — Verify: this must return 0.
-- ---------------------------------------------------------------------------
select count(*) as remaining_before_cutoff
  from public.farmer_sprays
 where spray_date < date '2026-07-09';

-- ---------------------------------------------------------------------------
-- STEP 5 — UNDO (only if you need the data back). Restores every backed-up row.
--          'overriding system value' is required because id is an identity col.
-- ---------------------------------------------------------------------------
-- insert into public.farmer_sprays
--   overriding system value
--   select * from public.farmer_sprays_backup_20260709;

-- ---------------------------------------------------------------------------
-- STEP 6 — Housekeeping: drop the backup once the team has re-entered the data
--          and you are certain you no longer need it. NOT reversible.
-- ---------------------------------------------------------------------------
-- drop table public.farmer_sprays_backup_20260709;
