-- ============================================================================
-- DroCon Cloud — restrict self sign-up to approved company domains.
-- Replaces handle_new_user so any sign-up from a non-approved email domain is
-- rejected (the auth user creation rolls back). Edit the domain list below to
-- add/remove allowed domains. Keep the first-user-becomes-admin behaviour.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
  email_domain text := lower(split_part(new.email,'@',2));
  allowed text[] := array['droconbharat.com','ibsideas.com'];   -- <- edit here
begin
  if not (email_domain = any(allowed)) then
    raise exception 'Sign-ups are restricted to %  email addresses.', array_to_string(allowed, ' or @');
  end if;

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
-- (Trigger on_auth_user_created from the base schema already calls this function.)
