-- ============================================================================
-- DroCon Cloud — link each Authorized Partner to their signed agreement
-- Lets the Authorized Partners home (Business Development) reference the partner's
-- agreement (a drive URL), connecting the pool to the Agreements tab. Safe to re-run.
-- ============================================================================
alter table public.authorized_partners add column if not exists agreement_link text;
