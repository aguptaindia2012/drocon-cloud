-- ============================================================================
-- 113. Consultant rate lookup + external receipt uploads
-- ----------------------------------------------------------------------------
--  • my_consultant_rate() : the signed-in consultant's rate + basis, so the
--    portal timesheet can pre-fill the line rate (external users can't read the
--    employees table directly).
--  • receipts bucket: let an external user upload/read receipts under their OWN
--    folder (<uid>/…); internal users keep full access for review.
-- ============================================================================
create or replace function public.my_consultant_rate()
returns table(rate numeric, rate_type text)
language sql security definer set search_path = public as $$
  select e.monthly_salary, e.rate_type
    from public.employees e
    join public.profiles p on p.party_id = e.id and p.party_type = 'consultant'
   where p.id = auth.uid()
   limit 1;
$$;
grant execute on function public.my_consultant_rate() to authenticated;

-- Receipts storage: internal (all) OR the object's owner folder = the caller.
drop policy if exists receipts_read   on storage.objects;
drop policy if exists receipts_insert on storage.objects;
drop policy if exists receipts_delete on storage.objects;
create policy receipts_read on storage.objects for select to authenticated using (
  bucket_id='receipts' and ( public.is_internal() or (storage.foldername(name))[1] = auth.uid()::text ) );
create policy receipts_insert on storage.objects for insert to authenticated with check (
  bucket_id='receipts' and ( public.is_internal() or (storage.foldername(name))[1] = auth.uid()::text ) );
create policy receipts_delete on storage.objects for delete to authenticated using (
  bucket_id='receipts' and ( public.is_internal() or (storage.foldername(name))[1] = auth.uid()::text ) );
