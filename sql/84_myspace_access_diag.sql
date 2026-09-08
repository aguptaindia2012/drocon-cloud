-- ============================================================================
-- 84. Diagnose "only some employees can see My Space"
-- ----------------------------------------------------------------------------
-- My Space (self-service attendance & expenses) is visible to every INTERNAL
-- signed-in user, and its CONTENT appears once the login is linked to an
-- employee record (by matching email). So an employee misses it for one of:
--   a) no login yet with the email HR recorded (they signed up with a different
--      address, or haven't signed up),
--   b) their login is marked EXTERNAL (partner) — external logins see only the
--      Partner Portal, never internal tabs,
--   c) email mismatch between the login and the employee record (not linked).
--
-- Run as an admin:   select * from public.admin_myspace_diag();
-- Non-admins get no rows. Read-only. Additive & idempotent.
-- ============================================================================

create or replace function public.admin_myspace_diag()
returns table(emp_name text, emp_email text, login_email text,
              has_login boolean, is_external boolean, linked boolean, reason text)
language sql stable security definer set search_path=public as $$
  select e.name, e.email, p.email,
         (p.id is not null)              as has_login,
         coalesce(p.is_external,false)   as is_external,
         (e.user_id is not null)         as linked,
         case
           when e.email is null or btrim(e.email)='' then 'FIX: no email on the employee record'
           when p.id is null then 'FIX: no login exists for this email (they signed up with a different address, or not yet)'
           when coalesce(p.is_external,false) then 'FIX: login is EXTERNAL — untick external in Team & Access'
           when e.user_id is null then 'INFO: not linked yet — have them reopen My Space (links on load)'
           else 'OK'
         end as reason
  from public.employees e
  left join public.profiles p on lower(btrim(p.email)) = lower(btrim(e.email))
  -- auth.uid() is null when run from the Supabase SQL editor (as owner); there
  -- it's already trusted. From the app it must be an admin.
  where (auth.uid() is null or public.has_role(array['admin']::user_role[]))
    and coalesce(e.status,'active') <> 'inactive'
  order by
    case when e.email is null or btrim(e.email)='' then 0
         when p.id is null then 1
         when coalesce(p.is_external,false) then 2
         when e.user_id is null then 3 else 4 end,
    e.name;
$$;
grant execute on function public.admin_myspace_diag() to authenticated;
