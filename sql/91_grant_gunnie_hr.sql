-- ============================================================================
-- 91. Grant Gunnie Gupta the full HR section + Expense Claims
-- ----------------------------------------------------------------------------
-- Gunnie manages staff & payroll (may see salaries) and loads staff expense
-- claims. This grants every HR tool plus expense_review via app_permissions.
--
-- Replace GUNNIE_EMAIL_HERE with the email she signs in with, then run.
-- Idempotent (on conflict do nothing). Test on a backup first.
-- To REVOKE later: delete the same rows, or untick the tools in Team & Access.
-- ============================================================================
insert into public.app_permissions (user_id, tool_key)
select p.id, t.tool_key
from public.profiles p
cross join (values
  ('hr_employees'),('hr_attendance'),('hr_compoff'),
  ('hr_salary'),('hr_revisions'),('hr_records'),
  ('hr_payslips'),('hr_incentives'),('hr_bonuses'),('hr_fnf'),
  ('expense_review')
) as t(tool_key)
where lower(p.email) = lower('GUNNIE_EMAIL_HERE')
on conflict (user_id, tool_key) do nothing;

-- verify:
-- select p.email, array_agg(ap.tool_key order by ap.tool_key) as tools
-- from public.app_permissions ap join public.profiles p on p.id = ap.user_id
-- where lower(p.email) = lower('GUNNIE_EMAIL_HERE') group by p.email;
