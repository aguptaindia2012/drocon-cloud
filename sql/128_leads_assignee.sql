-- ============================================================================
-- 128. Leads — "Responsible" person (assignee) in addition to Owner
-- ----------------------------------------------------------------------------
-- Owner = who the lead belongs to; assignee = a colleague it's handed to or
-- escalated to. Both optional. Additive.
-- ============================================================================
alter table public.leads add column if not exists assignee uuid references public.profiles(id);
create index if not exists leads_assignee_idx on public.leads(assignee);
