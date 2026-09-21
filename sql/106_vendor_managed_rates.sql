-- ============================================================================
-- 106. Vendor-managed rate card (with DroCon override)
-- ----------------------------------------------------------------------------
-- Vendors now set their own ₹/acre billing rates. The existing read policy
-- already lets a vendor see its own rows; add a write policy so it can manage
-- them. DroCon keeps full access via the existing internal write policy, so it
-- can view and override per the agreement.
-- ============================================================================
drop policy if exists vlcr_vendor_write on public.vendor_location_crop_rates;
create policy vlcr_vendor_write on public.vendor_location_crop_rates for all to authenticated
  using (vendor_id = public.my_vendor_id())
  with check (vendor_id = public.my_vendor_id());

-- Crop list for the vendor rate card (vendors can't read public.crops directly).
create or replace function public.list_crops()
returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from public.crops where coalesce(active,true)=true order by name;
$$;
grant execute on function public.list_crops() to authenticated;
