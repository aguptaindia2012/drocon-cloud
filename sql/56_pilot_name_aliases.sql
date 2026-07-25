-- ============================================================================
-- 56. Pilot name aliases — attribute acre-entry names to an employee-pilot
-- ----------------------------------------------------------------------------
-- Acre entries carry a free-text pilot name; historical/mis-spelled variants
-- won't match an employee's name exactly. An alias maps such a name to the
-- right DroCon employee so their acreage still counts toward incentives.
-- One alias -> one employee (unique on the normalised name). Additive.
-- ============================================================================

create table if not exists public.hr_pilot_aliases (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  alias       text not null,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create unique index if not exists hr_pilot_aliases_uk on public.hr_pilot_aliases(lower(btrim(alias)));

alter table public.hr_pilot_aliases enable row level security;
drop policy if exists hr_pilot_aliases_read   on public.hr_pilot_aliases;
drop policy if exists hr_pilot_aliases_insert on public.hr_pilot_aliases;
drop policy if exists hr_pilot_aliases_delete on public.hr_pilot_aliases;
create policy hr_pilot_aliases_read   on public.hr_pilot_aliases for select to authenticated using (true);
create policy hr_pilot_aliases_insert on public.hr_pilot_aliases for insert to authenticated with check (true);
create policy hr_pilot_aliases_delete on public.hr_pilot_aliases for delete to authenticated
  using (public.has_role(array['admin','approver']::user_role[]) or created_by = auth.uid());

grant select, insert, update, delete on public.hr_pilot_aliases to authenticated;
