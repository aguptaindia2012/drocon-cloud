-- ============================================================================
-- 108. Effective / backdate dates for closing a location and deactivating a pilot
-- ----------------------------------------------------------------------------
-- Crop & vendor rates are already effective-dated (location_crop_rates /
-- vendor_location_crop_rates .effective_from). This adds the two that weren't:
--   • pilots.inactive_from  — when a pilot became inactive (backdatable)
--   • close_pilot_assignment now accepts an effective end_date (backdatable)
-- ============================================================================
alter table public.pilots add column if not exists inactive_from date;

-- Close a pilot↔location assignment with an optional effective (backdated) date.
drop function if exists public.close_pilot_assignment(uuid, text);
create or replace function public.close_pilot_assignment(p_id uuid, p_note text, p_end_date date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_internal() then raise exception 'Not permitted'; end if;
  update public.pilot_assignments
     set status='closed',
         end_date = coalesce(p_end_date, end_date, current_date),
         closed_by = auth.uid(), closed_at = now(), note = coalesce(p_note, note)
   where id = p_id;
  if not found then raise exception 'Assignment not found'; end if;
  insert into public.audit_log(actor, action, entity, entity_id, note)
    values (auth.uid(), 'pilot_assignment_closed', 'pilot_assignments', p_id::text,
            coalesce(p_note,'')||case when p_end_date is not null then ' (effective '||p_end_date||')' else '' end);
end $$;
grant execute on function public.close_pilot_assignment(uuid, text, date) to authenticated;
