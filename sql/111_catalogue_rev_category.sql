-- ============================================================================
-- 111. Revenue category per catalogue item
-- ----------------------------------------------------------------------------
-- Adds an explicit rev_category label to each service & spare so the team can
-- tag every line item. Stored as the app's category KEY:
--   spray | demo | part | service | other   (blank = unlabelled)
-- The billing editor stamps this onto the invoice/quotation Revenue category
-- when the item is added, and the Receivables breakdown uses it.
-- ============================================================================
alter table public.service_catalogue add column if not exists rev_category text;
alter table public.spare_catalogue   add column if not exists rev_category text;

-- ---------------------------------------------------------------------------
-- OPTIONAL one-time seed — fills a *suggested* category (only where blank),
-- inferred from name/description + HSN, so the team starts from a draft rather
-- than a blank sheet. Review & correct in Administration → Catalogues.
-- Comment this block out if you'd rather label everything from scratch.
-- ---------------------------------------------------------------------------
update public.service_catalogue set rev_category = (
  case
    when lower(coalesce(name,'')||' '||coalesce(description,'')) ~* 'demo' then 'demo'
    when lower(coalesce(name,'')||' '||coalesce(description,'')) ~* '(servic|repair|mainten|overhaul|\ymro\y|\yamc\y|refurb)'
         or replace(coalesce(hsn_sac,''),' ','') ~ '^9987' then 'service'
    when lower(coalesce(name,'')||' '||coalesce(description,'')) ~* '(spray|aerial|agri)'
         or replace(coalesce(hsn_sac,''),' ','') ~ '^9986' then 'spray'
    when lower(coalesce(name,'')||' '||coalesce(description,'')) ~* '(part|spare|batter|propeller|\ymotor\y|nozzle|\ypump\y|blade|\yesc\y|frame|charger|drone|kit|\yarm\y)'
         or replace(coalesce(hsn_sac,''),' ','') ~ '^(8806|8807|8508|8507|8479|8413)' then 'part'
    else 'other'
  end
) where rev_category is null;

update public.spare_catalogue set rev_category = (
  case
    when lower(coalesce(name,'')||' '||coalesce(description,'')) ~* 'demo' then 'demo'
    when lower(coalesce(name,'')||' '||coalesce(description,'')) ~* '(servic|repair|mainten|overhaul|\ymro\y|\yamc\y|refurb)'
         or replace(coalesce(hsn_code,''),' ','') ~ '^9987' then 'service'
    when lower(coalesce(name,'')||' '||coalesce(description,'')) ~* '(spray|aerial|agri)'
         or replace(coalesce(hsn_code,''),' ','') ~ '^9986' then 'spray'
    when lower(coalesce(name,'')||' '||coalesce(description,'')) ~* '(part|spare|batter|propeller|\ymotor\y|nozzle|\ypump\y|blade|\yesc\y|frame|charger|drone|kit|\yarm\y)'
         or replace(coalesce(hsn_code,''),' ','') ~ '^(8806|8807|8508|8507|8479|8413)' then 'part'
    else 'other'
  end
) where rev_category is null;

-- ---------------------------------------------------------------------------
-- Coverage audit — run after labelling to confirm every category has items and
-- nothing is left blank. (spray/demo/part/service/other + blank)
-- ---------------------------------------------------------------------------
with items as (
  select coalesce(nullif(rev_category,''),'(unlabelled)') as rev_category from public.service_catalogue where active
  union all
  select coalesce(nullif(rev_category,''),'(unlabelled)') from public.spare_catalogue where active
),
cats(rev_category,label) as (
  values ('spray','Agriculture Spraying'),('demo','Demonstrations'),('part','Part sales'),
         ('service','Servicing of drones & batteries'),('other','Other / uncategorised'),('(unlabelled)','(unlabelled)')
)
select c.label,
       count(i.*) as active_items,
       case when c.rev_category='(unlabelled)' and count(i.*)>0 then '↷ label these'
            when c.rev_category in ('spray','demo','part','service') and count(i.*)=0 then '⚠ GAP — add items'
            else 'ok' end as note
  from cats c left join items i on i.rev_category=c.rev_category
 group by c.rev_category,c.label
 order by (c.rev_category='(unlabelled)'), c.label;
