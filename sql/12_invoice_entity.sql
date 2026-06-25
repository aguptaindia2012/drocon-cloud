-- ============================================================================
-- DroCon Cloud — billing entity on documents (DCB vs IBS)
-- DroCon Bharat (DCB) and Innovative Business Solution (IBS) both raise
-- invoices. This tags each document with its issuing entity so receivables and
-- dashboards can be viewed per entity. Generated documents default to 'DCB'.
-- Safe to re-run.
-- ============================================================================
alter table public.documents add column if not exists entity text not null default 'DCB';
create index if not exists documents_entity_idx on public.documents(entity);
