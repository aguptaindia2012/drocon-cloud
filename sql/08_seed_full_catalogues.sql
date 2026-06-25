-- ============================================================================
-- DroCon Cloud — full catalogue seed from the 2026 PDFs
--   Services: DCB Maintenance Rate Card 2026
--   Spares  : Drocon Bharat Spare Parts Catalogue 2026
-- HSN/SAC left blank for the team to assign. GST set to a sensible default
-- (services 18%, batteries/electrical 18%, mechanical 5%) — editable in-app.
-- Guarded by NOT EXISTS on name, so safe to re-run. Run AFTER 04_seed_catalogues.
-- ============================================================================

-- ---------------- SERVICES ----------------
insert into public.service_catalogue (name, hsn_sac, unit, default_rate, gst_rate, description)
select v.name, null, v.unit, v.rate, 18, v.descr
from (values
  ('Bench Inspection & Diagnostic','per drone',599,'Adjusted to repair if approved'),
  ('Comprehensive 40-Point Health Check','per drone',999,'Full structured health check'),
  ('Motor Inspection','per motor',99,null),
  ('Crash / Water-Damage Assessment','per drone',1499,'Adjusted to repair if approved'),
  ('Firmware / GCS Software Update','one-time',499,null),
  ('RC / Remote Controller Calibration','per session',399,null),
  ('Remote-Pilot Calibration Suite','per drone',699,null),
  ('Online / Remote Support','per incident',199,'Up to 30 min'),
  ('Spare Install — Tier 1 (Simple fitment)','per item/set',149,null),
  ('Spare Install — Tier 2 (Moderate fitment)','per item',399,null),
  ('Spare Install — Tier 3 (Complex/avionics fitment)','per item',799,null),
  ('Motor replacement + balance test','per motor',449,null),
  ('ESC replacement + calibration','per unit',649,null),
  ('Flight-controller replace + setup','per unit',1199,null),
  ('Tx/Rx binding & wiring','per job',449,null),
  ('Battery diagnostics & balancing','per drone',299,null),
  ('GPS module replace + calibration','per unit',649,null),
  ('Frame arm / boom replacement','per arm',599,null),
  ('Landing-gear replacement (labour)','per set',349,null),
  ('Water-pump replacement (labour)','per unit',349,null),
  ('Spray-line / wiring rework','per job',249,'From'),
  ('Half-Day Field Visit (<=25km, <=3h)','per half-day',1799,'Travel/stay extra'),
  ('Full-Day Field Visit (day fee)','per day',2999,'Travel/stay extra'),
  ('DCB Care - Essential (AMC)','per year',18999,'Annual maintenance plan'),
  ('DCB Care - Pro (AMC)','per year',37999,'Annual maintenance plan'),
  ('DCB Care - Elite (AMC)','per year',74999,'Annual maintenance plan')
) as v(name, unit, rate, descr)
where not exists (select 1 from public.service_catalogue s where s.name = v.name);

-- ---------------- SPARES ----------------
insert into public.spare_catalogue (name, hsn_code, unit, rate_excl_gst, gst_rate, description, current_stock)
select v.name, null, v.unit, v.rate, v.gst, v.descr, 0
from (values
  -- Propellers
  ('2388 Propeller','per set',999,5,'Propeller set'),
  ('2480 Propeller','per set',1049,5,'Propeller set'),
  ('3011 Propeller','per set',1249,5,'Propeller set'),
  -- Spraying System
  ('Spraying Kit / Pneumatic Connector with Pipe','per kit',849,5,null),
  ('Flat Nozzles','per piece',989,5,null),
  ('5 Ltr Water Pump','per piece',6299,5,null),
  ('8 Ltr Water Pump','per piece',7299,5,null),
  ('Pneumatic Connector 8-8-8 T','per piece',63,18,null),
  ('Pneumatic Connector 8-8-10 T','per piece',113,18,null),
  ('Pneumatic Connector 8-8-12 T','per piece',129,18,null),
  ('Pneumatic Connector 10-12 L','per piece',79,18,null),
  ('Pneumatic Connector 8-6','per piece',44,18,null),
  ('Pneumatic Pipe 6mm OD','per meter',45,18,null),
  ('Pneumatic Pipe 8mm OD','per meter',45,18,null),
  ('Pneumatic Pipe 10mm OD','per meter',55,18,null),
  ('Pneumatic Pipe 12mm OD','per meter',80,18,null),
  -- Landing Gear
  ('Horizontal Landing Gear (E610)','per set',3699,5,null),
  ('Horizontal Landing Gear (E616)','per set',3849,5,null),
  ('Vertical Landing Gear (E610)','per set',1949,5,null),
  ('Vertical Landing Gear (E616)','per set',2149,5,null),
  ('Fix Seat Connector','per piece',499,5,null),
  -- Power, Wiring & Connectors
  ('25200 mAh Battery Set','per set',41624,18,null),
  ('22500 mAh Battery Set','per set',37874,18,null),
  ('XT90 Power Connector','per piece',1199,18,null),
  ('Red Silicon Wire 8 AWG','per meter',359,18,null),
  ('Red Silicon Wire 12 AWG','per meter',149,18,null),
  ('Red Silicon Wire 14 AWG','per meter',99,18,null),
  ('Red Silicon Wire 16 AWG','per meter',79,18,null),
  ('Red Silicon Wire 18 AWG','per meter',59,18,null),
  ('Red Silicon Wire 22 AWG','per meter',39,18,null),
  ('Black Silicon Wire 8 AWG','per meter',359,18,null),
  ('Black Silicon Wire 12 AWG','per meter',149,18,null),
  ('Black Silicon Wire 14 AWG','per meter',99,18,null),
  ('Black Silicon Wire 16 AWG','per meter',79,18,null),
  ('Black Silicon Wire 18 AWG','per meter',59,18,null),
  ('Black Silicon Wire 22 AWG','per meter',39,18,null),
  ('XT90 Connector with Cap','per pair',129,18,null),
  ('XT60 Connector','per pair',49,18,null),
  ('T-Connector','per pair',39,18,null),
  ('Splice Connector (3-Pin, Wired)','per pair',59,18,null),
  -- Hardware
  ('Drone Screw (small)','per screw',5,5,null),
  ('Drone Screw (large)','per screw',20,5,null),
  -- Logistics
  ('Drone Sarthi Customised Carry Box','per piece',24599,18,'Box only, without bike; SS ventilated, 10L drone + 5 battery sets + charger')
) as v(name, unit, rate, gst, descr)
where not exists (select 1 from public.spare_catalogue s where s.name = v.name);
