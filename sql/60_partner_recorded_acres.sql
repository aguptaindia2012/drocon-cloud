-- ============================================================================
-- 60. Partner Portal: pull DroCon's recorded acres into a partner invoice
-- ----------------------------------------------------------------------------
-- An Authorized Partner can auto-fill their invoice from DroCon's verified acre
-- entries. Partners aren't linked to acre data, so an admin maps the pilot
-- name(s) whose sprays belong to a partner (partner_pilots). The partner (an
-- external login with no RLS access to acre_entries) pulls their day-wise acres
-- via a SECURITY DEFINER RPC scoped to their own partner id.
-- Additive.
-- ============================================================================

create table if not exists public.partner_pilots (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.authorized_partners(id) on delete cascade,
  pilot_name text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists partner_pilots_uk on public.partner_pilots(partner_id, lower(btrim(pilot_name)));

alter table public.partner_pilots enable row level security;
drop policy if exists partner_pilots_read  on public.partner_pilots;
drop policy if exists partner_pilots_write on public.partner_pilots;
create policy partner_pilots_read  on public.partner_pilots for select to authenticated using (true);
create policy partner_pilots_write on public.partner_pilots for all to authenticated
  using (public.has_role(array['admin']::user_role[]))
  with check (public.has_role(array['admin']::user_role[]));
grant select, insert, update, delete on public.partner_pilots to authenticated;

-- Day-wise recorded acres for a partner. External partner => forced to own
-- party_id; internal admin may pass p_partner. Rate = acres-weighted average of
-- the per-acre client rate on the entries (so gross reconstructs exactly).
create or replace function public.partner_recorded_acres(p_from date, p_to date, p_partner uuid default null)
returns table(work_date date, acres numeric, rate numeric)
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if public.is_internal() then
    pid := coalesce(p_partner, (select party_id from public.profiles where id = auth.uid()));
  else
    pid := (select party_id from public.profiles where id = auth.uid());
  end if;
  if pid is null then return; end if;
  return query
    select a.entry_date as work_date,
           round(sum(a.acres), 2) as acres,
           case when sum(a.acres) > 0
                then round(sum(a.acres * coalesce(a.rate,0)) / sum(a.acres), 2)
                else 0 end as rate
      from public.acre_entries a
      join public.partner_pilots pp
        on lower(btrim(pp.pilot_name)) = lower(btrim(coalesce(a.pilot_name,'')))
     where pp.partner_id = pid
       and a.entry_date between p_from and p_to
       and coalesce(a.approval_status,'approved') = 'approved'
     group by a.entry_date
     order by a.entry_date;
end $$;
grant execute on function public.partner_recorded_acres(date, date, uuid) to authenticated;
