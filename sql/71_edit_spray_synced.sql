-- ============================================================================
-- 71. Edit a spray as ONE record (keeps Farmer & Acre sides in sync) + lock
--     once invoiced.
-- ----------------------------------------------------------------------------
-- A spray posts to BOTH acre_entries and farmer_sprays, stamped with the same
-- source_id. Editing the two tables separately let them drift. edit_spray()
-- re-records both together from the full set of fields; delete_spray() removes
-- both. Both REFUSE if the acre row is on an invoice (farmer/client/vendor
-- doc, or a billed-override) — credit/withdraw that invoice first. Internal only.
-- ============================================================================

create or replace function public.spray_is_billed(p_source uuid)
returns boolean language sql stable set search_path = public as $$
  select exists(
    select 1 from public.acre_entries a
     where a.source_id = p_source
       and (a.farmer_doc_id is not null or a.client_doc_id is not null
            or a.vendor_doc_id is not null
            or coalesce(a.farmer_billed_override,false) or coalesce(a.client_billed_override,false)));
$$;
grant execute on function public.spray_is_billed(uuid) to authenticated;

create or replace function public.edit_spray(
  p_source uuid, p_date date, p_location uuid, p_pilot text,
  p_acres numeric, p_crate numeric, p_frate numeric,
  p_crop text, p_crop_id uuid, p_chemical text,
  p_farmer text, p_phone text, p_village text, p_gps boolean)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid; cr numeric := coalesce(p_crate,0); fr numeric := coalesce(p_frate,0);
        amt numeric; loc public.spray_locations%rowtype; clientnm text;
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if p_source is null then raise exception 'This entry has no linked record to edit as one. Edit it as a single row.'; end if;
  if public.spray_is_billed(p_source) then
    raise exception 'This entry is on an invoice — credit or withdraw that invoice first, then edit.'; end if;

  amt := p_acres * (cr + fr);
  if p_crop_id is not null and not exists (select 1 from public.crops c where c.id = p_crop_id) then p_crop_id := null; end if;
  pid := (select id from public.pilots where lower(btrim(name)) = lower(btrim(coalesce(p_pilot,''))) order by created_at limit 1);
  if p_location is not null then select * into loc from public.spray_locations where id = p_location;
    select coalesce(c.firm_name,c.name) into clientnm from public.clients c where c.id = loc.client_id; end if;

  update public.acre_entries
     set entry_date = coalesce(p_date, entry_date),
         location_id = coalesce(p_location, location_id),
         pilot_id = pid, pilot_name = nullif(btrim(coalesce(p_pilot,'')),''),
         acres = p_acres, client_rate = nullif(cr,0), farmer_rate = nullif(fr,0),
         rate = nullif(cr+fr,0), amount = nullif(amt,0),
         crop = nullif(p_crop,''), crop_id = p_crop_id, chemical = nullif(p_chemical,'')
   where source_id = p_source;

  update public.farmer_sprays
     set spray_date = coalesce(p_date, spray_date),
         pilot_name = nullif(btrim(coalesce(p_pilot,'')),''),
         farmer_name = nullif(p_farmer,''), contact_no = nullif(p_phone,''), village = nullif(p_village,''),
         crop = nullif(p_crop,''), chemical_company = nullif(p_chemical,''),
         acre = nullif(p_acres,0), rate = nullif(cr+fr,0), amount = nullif(amt,0),
         gps_image_present = coalesce(p_gps,false),
         client_name = coalesce(clientnm, client_name),
         state = coalesce(loc.state, state), district = coalesce(loc.district, district)
   where source_id = p_source;

  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'edited','spray',p_source::text,'re-recorded acre + farmer together');
end $$;
grant execute on function public.edit_spray(uuid,date,uuid,text,numeric,numeric,numeric,text,uuid,text,text,text,text,boolean) to authenticated;

create or replace function public.delete_spray(p_source uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  if public.spray_is_billed(p_source) then
    raise exception 'This entry is on an invoice — credit or withdraw that invoice first, then delete.'; end if;
  delete from public.acre_entries  where source_id = p_source;
  delete from public.farmer_sprays where source_id = p_source;
  insert into public.audit_log(actor,action,entity,entity_id,note)
    values (auth.uid(),'deleted','spray',p_source::text,'deleted acre + farmer together');
end $$;
grant execute on function public.delete_spray(uuid) to authenticated;
