-- ============================================================================
-- 78. Fix: new client number always started at DCB/CL/0001
-- ----------------------------------------------------------------------------
-- The Clients form stores the number in client_ref, but next_client_code() was
-- reading a different, mostly-empty column (client_code) — so max() was 0 and it
-- always returned 0001. Read the real client_ref (falling back to client_code),
-- take the trailing number of whatever format is stored, and return the next in
-- the standard DCB/CL/#### format. Replaces one function.
-- ============================================================================

create or replace function public.next_client_code()
returns text language sql stable security definer set search_path = public as $$
  select 'DCB/CL/' || lpad((
    coalesce(max( (substring(coalesce(client_ref, client_code) from '([0-9]+)$'))::bigint ), 0) + 1
  )::text, 4, '0')
  from public.clients
  where coalesce(client_ref, client_code) ~ '[0-9]+$';
$$;
grant execute on function public.next_client_code() to authenticated;
