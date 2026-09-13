-- ============================================================================
-- 85. Allow admin-provisioned accounts on ANY email domain
-- ----------------------------------------------------------------------------
-- We are moving to ADMIN-ONLY account creation (public self-signup is turned off
-- in Supabase → Authentication). The old handle_new_user() rejected any sign-up
-- whose email domain wasn't droconbharat.com / ibsideas.com — which would also
-- block admins from creating EXTERNAL portal logins (vendors/partners on gmail,
-- etc.). With self-signup disabled, the only way a row reaches auth.users is an
-- admin using the service role, so the domain gate is now redundant and blocking.
--
-- This ONLY changes what happens when a NEW account is created. It does NOT touch
-- any existing login, profile, password, role, or access level.
--
-- ⚠ Apply this together with disabling "Allow new users to sign up" in Supabase
--   Auth settings — otherwise anyone could self-register with any email.
-- Additive & idempotent (replaces one function).
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_first boolean;
begin
  select count(*) = 0 into is_first from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when is_first then 'admin'::user_role else 'drafter'::user_role end
  );
  return new;
end $$;
-- (Trigger on_auth_user_created already calls this function.)
