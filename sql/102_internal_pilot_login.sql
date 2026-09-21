-- ============================================================================
-- 102. Let an INTERNAL staff login use the Pilot Portal (e.g. Naveen)
-- ----------------------------------------------------------------------------
-- Links a DroCon employee's regular (internal) login to a pilot record via
-- profiles.pilot_id, so they get the Pilot Portal without a separate external
-- login. my_pilot_id()/my_vendor_id() now resolve for such internal staff too.
-- Admin links/unlinks by email from the Pilots register.
-- ============================================================================
alter table public.profiles add column if not exists pilot_id uuid references public.pilots(id);
create index if not exists profiles_pilot_idx on public.profiles(pilot_id);

-- The pilot the caller is: external pilot login OR internal staff linked via pilot_id.
create or replace function public.my_pilot_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.party_id from public.profiles p
       where p.id = auth.uid() and coalesce(p.is_external,false)=true and p.party_type='pilot'),
    (select p.pilot_id  from public.profiles p where p.id = auth.uid())
  );
$$;
grant execute on function public.my_pilot_id() to authenticated;

-- The vendor the caller belongs to (external vendor/pilot, or internal linked pilot).
create or replace function public.my_vendor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when p.party_type='vendor' and coalesce(p.is_external,false) then p.party_id
    when p.party_type='pilot'  and coalesce(p.is_external,false) then (select vendor_id from public.pilots where id=p.party_id)
    when p.pilot_id is not null then (select vendor_id from public.pilots where id=p.pilot_id)
    else null end
  from public.profiles p where p.id = auth.uid();
$$;
grant execute on function public.my_vendor_id() to authenticated;

-- Admin: link (or unlink with p_pilot=null) an internal login to a pilot, by email.
create or replace function public.admin_link_pilot_login(p_email text, p_pilot uuid)
returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_role(array['admin']::user_role[]) then raise exception 'Admins only'; end if;
  if p_pilot is not null then
    update public.profiles set pilot_id = null where pilot_id = p_pilot;   -- one internal login per pilot
  end if;
  update public.profiles set pilot_id = p_pilot where lower(email) = lower(btrim(p_email));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No login found for %', p_email; end if;
  return p_email;
end $$;
grant execute on function public.admin_link_pilot_login(text, uuid) to authenticated;

-- Admin/staff: which internal login (email) is linked to this pilot?
create or replace function public.pilot_linked_login(p_pilot uuid)
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles
   where pilot_id = p_pilot and coalesce(is_external,false)=false limit 1;
$$;
grant execute on function public.pilot_linked_login(uuid) to authenticated;
