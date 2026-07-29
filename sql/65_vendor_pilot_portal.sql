-- ============================================================================
-- 65. Vendor & Pilot Portal — Phase 1: identities & logins
-- ----------------------------------------------------------------------------
-- Goal: let VENDORS log in, manage their own PILOTS, and request pilot logins
-- that a DroCon team member must APPROVE before they work.
--
-- Reuses the existing external-login model (profiles.is_external / party_type /
-- party_id + partner_invites). Two new party types flow through it:
--   * 'vendor' — party_id = vendors.id   (invited by DroCon)
--   * 'pilot'  — party_id = pilots.id     (requested by the vendor, approved by DroCon)
--
-- Idempotent / additive. No data deleted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. partner_invites: an approval status + which vendor a pilot invite is for.
--    Admin/manager-created invites are 'approved' immediately (unchanged
--    behaviour). Vendor-created pilot invites start 'pending'.
-- ---------------------------------------------------------------------------
alter table public.partner_invites add column if not exists status    text not null default 'approved';
alter table public.partner_invites add column if not exists vendor_id uuid references public.vendors(id);

-- ---------------------------------------------------------------------------
-- 2. Sign-up consumes an invite ONLY when it is approved. A pending pilot invite
--    cannot create a working login until DroCon approves it.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first     boolean;
  email_domain text := lower(split_part(new.email,'@',2));
  allowed      text[] := array['droconbharat.com','ibsideas.com'];
  inv          public.partner_invites%rowtype;
begin
  select * into inv from public.partner_invites
    where lower(email) = lower(new.email) and used_at is null and status = 'approved'
    order by created_at desc limit 1;

  if inv.id is not null then
    insert into public.profiles (id, email, full_name, role, is_external, party_type, party_id)
    values (
      new.id, new.email,
      coalesce(new.raw_user_meta_data->>'full_name', inv.party_name, split_part(new.email,'@',1)),
      'drafter'::user_role, true, inv.party_type, inv.party_id
    );
    update public.partner_invites set used_at = now(), used_by = new.id where id = inv.id;
    return new;
  end if;

  if not (email_domain = any(allowed)) then
    raise exception 'Sign-ups are restricted to % email addresses (or an admin invite).', array_to_string(allowed,' or @');
  end if;

  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when is_first then 'admin'::user_role else 'drafter'::user_role end
  );
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Who is the current external user? (security definer — read profiles safely)
-- ---------------------------------------------------------------------------
create or replace function public.my_party_type()
returns text language sql stable security definer set search_path = public as $$
  select p.party_type from public.profiles p
   where p.id = auth.uid() and coalesce(p.is_external,false) = true;
$$;

-- The vendor the current user belongs to: a vendor login → its own id;
-- a pilot login → the vendor that owns the pilot; internal/none → null.
create or replace function public.my_vendor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when p.party_type = 'vendor' then p.party_id
    when p.party_type = 'pilot'  then (select pl.vendor_id from public.pilots pl where pl.id = p.party_id)
    else null end
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_external,false) = true;
$$;

create or replace function public.my_pilot_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case when p.party_type = 'pilot' then p.party_id else null end
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_external,false) = true;
$$;

grant execute on function public.my_party_type() to authenticated;
grant execute on function public.my_vendor_id() to authenticated;
grant execute on function public.my_pilot_id()  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. pilots: a vendor may read & manage ITS OWN pilots (additive to the
--    internal-only policies). Delete stays internal/admin only.
-- ---------------------------------------------------------------------------
drop policy if exists pilots_vendor_read on public.pilots;
create policy pilots_vendor_read on public.pilots for select to authenticated
  using (vendor_id = public.my_vendor_id());

drop policy if exists pilots_vendor_ins on public.pilots;
create policy pilots_vendor_ins on public.pilots for insert to authenticated
  with check (public.my_party_type() = 'vendor' and vendor_id = public.my_vendor_id());

drop policy if exists pilots_vendor_upd on public.pilots;
create policy pilots_vendor_upd on public.pilots for update to authenticated
  using (public.my_party_type() = 'vendor' and vendor_id = public.my_vendor_id())
  with check (vendor_id = public.my_vendor_id());

-- ---------------------------------------------------------------------------
-- 5. partner_invites: a vendor may create a PENDING pilot invite for its own
--    pilots and read its own invites. Only DroCon (portal admin) can approve.
-- ---------------------------------------------------------------------------
drop policy if exists partner_invites_vendor_ins on public.partner_invites;
create policy partner_invites_vendor_ins on public.partner_invites for insert to authenticated
  with check (
    public.my_party_type() = 'vendor'
    and party_type = 'pilot'
    and status = 'pending'
    and vendor_id = public.my_vendor_id()
  );

drop policy if exists partner_invites_vendor_read on public.partner_invites;
create policy partner_invites_vendor_read on public.partner_invites for select to authenticated
  using (vendor_id = public.my_vendor_id());

-- ---------------------------------------------------------------------------
-- 6. Approve / reject a pending pilot login (DroCon portal admins only).
--    Approving flips status to 'approved' so the next sign-up can consume it.
-- ---------------------------------------------------------------------------
create or replace function public.set_pilot_invite_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_portal_admin() then raise exception 'Not permitted'; end if;
  if p_status not in ('approved','rejected','pending') then raise exception 'Bad status'; end if;
  update public.partner_invites set status = p_status where id = p_id and party_type = 'pilot';
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'pilot_login_'||p_status, 'partner_invites', p_id::text, null);
end $$;
grant execute on function public.set_pilot_invite_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Convenience view: pending pilot logins awaiting DroCon approval.
-- ---------------------------------------------------------------------------
create or replace view public.v_pilot_login_requests as
  select i.id, i.email, i.party_name as pilot_name, i.vendor_id,
         coalesce(v.firm_name, v.name) as vendor_name, i.status, i.created_at, i.used_at
    from public.partner_invites i
    left join public.vendors v on v.id = i.vendor_id
   where i.party_type = 'pilot';
grant select on public.v_pilot_login_requests to authenticated;
