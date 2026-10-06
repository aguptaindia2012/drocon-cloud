-- ============================================================================
-- 122. Spare catalogue — rate-card columns
-- ----------------------------------------------------------------------------
-- Adds the Oct-2026 spares price-list fields to spare_catalogue so the team can
-- enter them per item. SPARES ONLY (service_catalogue is untouched). Existing
-- rows keep NULLs until the team fills them in; nothing is overwritten.
--   product_category : rate-card section (Propellers, Landing Gear, …)
--   mrp_incl         : MRP including GST
--   discount         : % off MRP
--   offer            : offered selling price (incl GST)
--   pkg_pct          : packaging %
--   base_cost        : Cost + OH + Profit (single figure)
-- Base Rate (excl GST) and GST % reuse the existing rate_excl_gst / gst_rate.
-- Additive / idempotent.
-- ============================================================================
alter table public.spare_catalogue add column if not exists product_category text;
alter table public.spare_catalogue add column if not exists mrp_incl  numeric;
alter table public.spare_catalogue add column if not exists discount  numeric;   -- % off MRP
alter table public.spare_catalogue add column if not exists offer     numeric;   -- selling price incl GST
alter table public.spare_catalogue add column if not exists pkg_pct   numeric;   -- packaging %
alter table public.spare_catalogue add column if not exists base_cost numeric;   -- Cost + OH + Profit
