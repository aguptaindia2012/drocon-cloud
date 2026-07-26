-- ============================================================================
-- 59. Employee self-service Expense Claims (all forms) + receipts storage
-- ----------------------------------------------------------------------------
-- Employees (incl. HR-pilot employees) log in and file expense claims of eight
-- types (DA, mileage, hotel, local transport, hired help, misc, house rent,
-- advance request), attaching receipt images/PDFs. HR/approvers review, approve
-- and mark paid. An approved Advance Request creates a row in public.advances.
--
-- Identity: a login is tied to an employee by matching email. link_employee_login()
-- stamps employees.user_id for the current user so RLS can scope "my claims".
-- Additive.
-- ============================================================================

-- link the logged-in user to their employee record (by matching email)
alter table public.employees add column if not exists user_id uuid references public.profiles(id);
create index if not exists employees_user_idx on public.employees(user_id);

create or replace function public.link_employee_login()
returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid; myemail text;
begin
  select email into myemail from public.profiles where id = auth.uid();
  if myemail is null or myemail = '' then return null; end if;
  update public.employees
     set user_id = auth.uid()
   where lower(email) = lower(myemail)
     and (user_id is null or user_id = auth.uid())
   returning id into eid;
  if eid is null then
    select id into eid from public.employees where user_id = auth.uid() limit 1;
  end if;
  return eid;
end $$;
grant execute on function public.link_employee_login() to authenticated;

-- ---------------------------------------------------------------------------
-- Expense claims
-- ---------------------------------------------------------------------------
create table if not exists public.expense_claims (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references public.employees(id) on delete set null,
  employee_name text,
  claim_type    text not null check (claim_type in
                  ('da','mileage','hotel','local_transport','hired_help','misc','house_rent','advance')),
  period        text,                       -- 'YYYY-MM' or free text
  title         text,
  purpose       text,
  lines         jsonb not null default '[]',
  extra         jsonb,                       -- house_rent / advance specifics
  receipts      jsonb not null default '[]', -- [{path,name}]
  total         numeric default 0,
  status        text not null default 'submitted' check (status in ('draft','submitted','approved','rejected','paid')),
  reviewer      uuid references public.profiles(id),
  reviewed_at   timestamptz,
  approver      uuid references public.profiles(id),
  approved_at   timestamptz,
  paid_at       timestamptz,
  mode          text,
  advance_id    uuid references public.advances(id),
  note          text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists expense_claims_emp_idx    on public.expense_claims(employee_id);
create index if not exists expense_claims_status_idx on public.expense_claims(status);

drop trigger if exists expense_claims_touch on public.expense_claims;
create trigger expense_claims_touch before update on public.expense_claims
  for each row execute function public.touch_updated_at_ops();

alter table public.expense_claims enable row level security;
drop policy if exists expense_claims_read   on public.expense_claims;
drop policy if exists expense_claims_insert on public.expense_claims;
drop policy if exists expense_claims_update on public.expense_claims;
drop policy if exists expense_claims_delete on public.expense_claims;
-- approvers/admins see all; everyone else sees only their own claims
create policy expense_claims_read on public.expense_claims for select to authenticated using (
  public.has_role(array['admin','approver']::user_role[])
  or created_by = auth.uid()
  or employee_id in (select id from public.employees where user_id = auth.uid())
);
create policy expense_claims_insert on public.expense_claims for insert to authenticated
  with check (public.is_internal());
create policy expense_claims_update on public.expense_claims for update to authenticated using (
  public.has_role(array['admin','approver']::user_role[])
  or created_by = auth.uid()
  or employee_id in (select id from public.employees where user_id = auth.uid())
);
create policy expense_claims_delete on public.expense_claims for delete to authenticated using (
  public.has_role(array['admin']::user_role[]) or created_by = auth.uid()
);

grant select, insert, update, delete on public.expense_claims to authenticated;

-- ---------------------------------------------------------------------------
-- Receipts storage bucket (private) + policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('receipts','receipts', false)
  on conflict (id) do nothing;

drop policy if exists receipts_read   on storage.objects;
drop policy if exists receipts_insert on storage.objects;
drop policy if exists receipts_delete on storage.objects;
create policy receipts_read   on storage.objects for select to authenticated using (bucket_id='receipts' and public.is_internal());
create policy receipts_insert on storage.objects for insert to authenticated with check (bucket_id='receipts' and public.is_internal());
create policy receipts_delete on storage.objects for delete to authenticated using (bucket_id='receipts' and public.is_internal());
