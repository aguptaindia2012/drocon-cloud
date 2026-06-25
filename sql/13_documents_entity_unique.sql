-- ============================================================================
-- DroCon Cloud — make document numbers unique PER ENTITY
-- DCB and IBS reuse the same invoice-number series, so uniqueness must include
-- the entity. Replaces the (doc_type, number) unique index with
-- (doc_type, entity, number). Safe to re-run.
-- ============================================================================
drop index if exists public.documents_number_uniq;
create unique index if not exists documents_entity_number_uniq
  on public.documents(doc_type, entity, number);
