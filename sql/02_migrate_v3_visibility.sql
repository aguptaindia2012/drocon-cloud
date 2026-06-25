-- ============================================================================
-- DroCon Bharat Agreement Studio — Cloud, migration v3 (visibility)
-- Restricts who can SEE agreements:
--   • a drafter/viewer sees only agreements they created or are assigned to approve
--   • approvers and admins see everything (so they can review)
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================================

drop policy if exists agreements_read on public.agreements;

create policy agreements_read on public.agreements
  for select to authenticated
  using (
    created_by = auth.uid()
    or assigned_approver = auth.uid()
    or public.has_role(array['approver','admin']::user_role[])
  );

-- Note: the INSERT/UPDATE/DELETE policies are unchanged. This only affects
-- which rows each person can read. To go back to full shared visibility, run:
--   drop policy if exists agreements_read on public.agreements;
--   create policy agreements_read on public.agreements
--     for select to authenticated using (true);
