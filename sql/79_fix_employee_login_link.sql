-- ============================================================================
-- 79. Fix: new HR employee can't be recognised (stuck on "My Space", app says
--     "your login isn't linked to an employee record").
-- ----------------------------------------------------------------------------
-- link_employee_login() matched profiles.email = employees.email but only
-- lower()-ed the two sides — a trailing space / stray character typed into the
-- HR Email field defeated the match. Now we trim() both sides too. Also expose
-- a diagnostic so admins can see WHY a given login isn't linking.
-- Replaces one function, adds one diagnostic function. Additive & idempotent.
-- ============================================================================

create or replace function public.link_employee_login()
returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid; myemail text;
begin
  select email into myemail from public.profiles where id = auth.uid();
  if myemail is null or btrim(myemail) = '' then return null; end if;
  update public.employees
     set user_id = auth.uid()
   where lower(btrim(email)) = lower(btrim(myemail))
     and (user_id is null or user_id = auth.uid())
   returning id into eid;
  if eid is null then
    select id into eid from public.employees where user_id = auth.uid() limit 1;
  end if;
  return eid;
end $$;
grant execute on function public.link_employee_login() to authenticated;

-- Diagnostic: tells the CURRENT logged-in user why linking did / didn't work.
-- Returns their profile email + any employee rows whose email is a near match,
-- so an admin (or the user) can spot a typo, a duplicate, or a user_id already
-- pointing at someone else.
create or replace function public.diagnose_employee_link()
returns table(my_email text, emp_id uuid, emp_name text, emp_email text,
              emp_user_id uuid, exact_match boolean)
language sql security definer set search_path = public as $$
  with me as (select email as e from public.profiles where id = auth.uid())
  select (select e from me) as my_email,
         emp.id, emp.name, emp.email, emp.user_id,
         (lower(btrim(emp.email)) = lower(btrim((select e from me)))) as exact_match
  from public.employees emp
  where emp.email is not null
    and lower(btrim(emp.email)) like '%' || lower(btrim(split_part((select e from me),'@',1))) || '%'
  order by exact_match desc, emp.name;
$$;
grant execute on function public.diagnose_employee_link() to authenticated;
