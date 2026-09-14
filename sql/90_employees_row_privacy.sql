-- ============================================================================
-- 90. Protect salaries: employees table read is HR/admin-only + own row
-- ----------------------------------------------------------------------------
-- Previously employees_read was `using (true)` — ANY signed-in user could read
-- every employee row (incl. monthly_salary). That meant giving someone the HR
-- "Employees" tool (so they could use My Space) exposed everyone's salary.
--
-- New rule for SELECT on employees:
--   * admins & approvers  -> all rows (HR/finance need this)
--   * anyone holding an HR-related tool grant (hr_*, consultants, expense_review)
--     -> all rows (they legitimately manage employees)
--   * everyone else       -> ONLY their own linked row (user_id = auth.uid())
--
-- This lets **My Space** work for every employee (reads their own record) WITHOUT
-- granting the HR Employees module — so you can revoke that grant and salaries
-- stay private. Insert/update/delete policies are unchanged.
-- Safe & idempotent. Test on a backup first.
-- ============================================================================
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated using (
  user_id = auth.uid()
  or public.has_role(array['admin','approver']::user_role[])
  or exists (
    select 1 from public.app_permissions ap
    where ap.user_id = auth.uid()
      and (ap.tool_key like 'hr\_%' escape '\' or ap.tool_key in ('consultants','expense_review'))
  )
);
