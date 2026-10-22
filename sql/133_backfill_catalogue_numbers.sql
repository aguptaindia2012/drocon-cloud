-- ============================================================================
-- 133. Back-fill Part / Service numbers for EXISTING catalogue items
-- ----------------------------------------------------------------------------
-- Assigns PRT-#### to spares and SRV-#### to services that have no number yet,
-- in creation order, continuing after the highest existing number. Only fills
-- NULLs, so it's safe to re-run and won't touch items that already have a
-- number (e.g. ones created after migration 131).
-- ============================================================================

-- Spares -> part_no (PRT-####)
with mx as (
  select coalesce(max(nullif(regexp_replace(part_no, '\D', '', 'g'), '')::int), 0) as m
  from public.spare_catalogue where part_no ~ '\d'
),
tofill as (
  select id, row_number() over (order by created_at nulls last, name) as rn
  from public.spare_catalogue where part_no is null
)
update public.spare_catalogue s
set part_no = 'PRT-' || lpad(((select m from mx) + t.rn)::text, 4, '0')
from tofill t where s.id = t.id;

-- Services -> service_no (SRV-####)
with mx as (
  select coalesce(max(nullif(regexp_replace(service_no, '\D', '', 'g'), '')::int), 0) as m
  from public.service_catalogue where service_no ~ '\d'
),
tofill as (
  select id, row_number() over (order by created_at nulls last, name) as rn
  from public.service_catalogue where service_no is null
)
update public.service_catalogue s
set service_no = 'SRV-' || lpad(((select m from mx) + t.rn)::text, 4, '0')
from tofill t where s.id = t.id;
