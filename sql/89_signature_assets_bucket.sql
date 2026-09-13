-- ============================================================================
-- 89. Public bucket for signature images (logos)
-- ----------------------------------------------------------------------------
-- Email clients fetch signature images anonymously, so logos must live at a
-- PUBLIC, permanent URL. This bucket is public-read; only internal users upload.
-- Additive & idempotent.
-- ============================================================================
insert into storage.buckets (id, name, public) values ('sig-assets','sig-assets', true)
  on conflict (id) do nothing;

drop policy if exists sigasset_read   on storage.objects;
drop policy if exists sigasset_write  on storage.objects;
drop policy if exists sigasset_delete on storage.objects;
create policy sigasset_read   on storage.objects for select to public        using (bucket_id='sig-assets');
create policy sigasset_write  on storage.objects for insert to authenticated with check (bucket_id='sig-assets' and public.is_internal());
create policy sigasset_delete on storage.objects for delete to authenticated using (bucket_id='sig-assets' and public.is_internal());
