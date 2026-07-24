-- ============================================================================
-- 45. Find and clean duplicate receipts (same invoice, date and amount)
-- ----------------------------------------------------------------------------
-- "Exactly same" = same invoice (so same client), same paid_on, same amount.
-- The plan keeps the EARLIEST copy of each group and removes the rest.
-- Backup-first and reversible. Run the steps IN ORDER; read each before moving on.
-- ============================================================================

-- Deleting a receipt must also remove its journal entry, else the trial balance
-- double-counts. There is an unpost trigger for cash movements but not for
-- receipts — add it now, so this cleanup and every future delete stay consistent.
create or replace function public.unpost_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounting_entries where ref_type='receipt' and ref_id = old.id::text;
  return old;
end $$;
drop trigger if exists receipt_unjournal on public.payments;
create trigger receipt_unjournal after delete on public.payments
  for each row execute function public.unpost_receipt();

-- ---------------------------------------------------------------------------
-- STEP 1 — REVIEW. Read this before deleting anything. One row per duplicate
--          group; 'copies' > 1 means duplicates exist. 'extra_ids' are the ones
--          that would be deleted (the earliest of each group is kept).
-- ---------------------------------------------------------------------------
with ranked as (
  select p.*,
         row_number() over (partition by p.document_id, p.paid_on, p.amount order by p.id) as rn
    from public.payments p
)
select r.document_id,
       d.number                                                   as invoice_no,
       coalesce(d.party_snapshot->>'firmName',
                d.party_snapshot->>'name')                        as client,
       r.paid_on,
       r.amount,
       count(*)                                                    as copies,
       (array_agg(r.id order by r.id))[1]                          as keep_id,
       array_agg(r.id order by r.id) filter (where r.rn > 1)       as extra_ids,
       array_agg(distinct coalesce(r.mode,'—'))                    as modes,
       min(r.created_at)                                           as first_entered,
       max(r.created_at)                                           as last_entered
  from ranked r
  join public.documents d on d.id = r.document_id
 group by r.document_id, d.number, client, r.paid_on, r.amount
having count(*) > 1
 order by r.paid_on desc, client;

-- If STEP 1 returns nothing, there are no exact duplicates — stop here.
-- NOTE: rows with mode 'Tracker import' are historical bulk imports, not team
-- entries. If any duplicate groups are Tracker imports you did NOT mean to
-- clean, tell me and I will narrow the delete.

-- ---------------------------------------------------------------------------
-- STEP 2 — BACKUP the rows that will be deleted (the extras only).
-- ---------------------------------------------------------------------------
create table if not exists public.payments_dupe_backup_20260725 as
  select p.* from public.payments p
   where p.id in (
     select id from (
       select id, row_number() over (partition by document_id, paid_on, amount order by id) rn
         from public.payments
     ) x where x.rn > 1
   );

-- confirm the count matches the total 'extra_ids' you saw in STEP 1
select count(*) as rows_to_delete from public.payments_dupe_backup_20260725;

-- ---------------------------------------------------------------------------
-- STEP 3 — DELETE the extras. The receipt_unjournal trigger removes their
--          journal entries automatically. Only run once STEP 1 + 2 look right.
-- ---------------------------------------------------------------------------
delete from public.payments
 where id in (select id from public.payments_dupe_backup_20260725);

-- ---------------------------------------------------------------------------
-- STEP 4 — VERIFY. Re-run STEP 1's query; it must now return 0 rows. And the
--          trial balance should still balance:
-- ---------------------------------------------------------------------------
select round(sum(debit),2) as total_debit, round(sum(credit),2) as total_credit,
       round(sum(debit)-sum(credit),2) as should_be_zero
  from public.accounting_entries;

-- ---------------------------------------------------------------------------
-- STEP 5 — UNDO (only if needed). Restores every deleted receipt; the journal
--          re-posts via the existing receipt_journal trigger.
-- ---------------------------------------------------------------------------
-- insert into public.payments
--   overriding system value
--   select * from public.payments_dupe_backup_20260725;

-- ---------------------------------------------------------------------------
-- STEP 6 — Drop the backup once you are satisfied. NOT reversible.
-- ---------------------------------------------------------------------------
-- drop table public.payments_dupe_backup_20260725;
