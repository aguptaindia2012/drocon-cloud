-- ============================================================================
-- DroCon Cloud — seed data for Service & Spare catalogues + a default BOM.
-- Safe to re-run: guarded by NOT EXISTS on name.
-- Run AFTER 03_migrate_v4_ops.sql.
-- ============================================================================

-- ---------- SERVICE CATALOGUE ----------------------------------------------
insert into public.service_catalogue (name, hsn_sac, unit, default_rate, gst_rate, description)
select v.name, v.hsn_sac, v.unit, v.rate, v.gst, v.descr
from (values
  ('Aerial Spraying - Agriculture Services (Short Crop)', '9986', 'Acre', 400, 0, 'Standard rate for short-crop aerial spraying'),
  ('Aerial Spraying - Agriculture Services (Tall Crop)',  '9986', 'Acre', 500, 0, 'Standard rate for tall-crop aerial spraying'),
  ('Aerial Spraying - Agriculture Services (Custom)',     '9986', 'Acre', null, 0, 'Aerial spraying at a location-specific negotiated rate'),
  ('Drone Demonstration / Training',                      '9986', 'Day',  null, 18, 'On-site demonstration or pilot training')
) as v(name, hsn_sac, unit, rate, gst, descr)
where not exists (select 1 from public.service_catalogue s where s.name = v.name);

-- ---------- SPARE CATALOGUE -------------------------------------------------
insert into public.spare_catalogue (name, hsn_code, unit, rate_excl_gst, gst_rate, description, current_stock)
select v.name, v.hsn, v.unit, v.rate, v.gst, v.descr, v.stock
from (values
  ('Propeller 2480 CW',                '88071000', 'Set',   null, 5, null, 2),
  ('Propeller 2480 CCW',               '88071000', 'Set',   null, 5, null, 2),
  ('Propeller 2388 CW',                '88071000', 'Set',   null, 5, null, 1),
  ('Propeller 2388 CCW',               '88071000', 'Set',   null, 5, null, 0),
  ('Propeller 3011 CW',                '88071000', 'Set',   null, 5, null, 1),
  ('Propeller 3011 CCW',               '88071000', 'Set',   null, 5, null, 0),
  ('Hub 3011',                         null,        'Unit',  null, 5, null, 2),
  ('Horizontal Landing Gear 610',      '88073020', 'Set',   null, 5, null, 1),
  ('Vertical Landing Gear',            '88073020', 'Set',   null, 5, null, 0),
  ('Landing Gear Bar 610',             '88073020', 'Unit',  null, 5, null, 2),
  ('Landing Gear Brace 610',           '88073020', 'Unit',  null, 5, null, 4),
  ('Landing Gear Bar 616',             '88073020', 'Unit',  null, 5, null, 3),
  ('Landing Gear Brace 616',           '88073020', 'Unit',  null, 5, null, 8),
  ('Arm Joint',                        '88073020', 'Unit',  null, 5, null, 1),
  ('Landing Gear Mount',               '88073020', 'Unit',  null, 5, null, 16),
  ('Landing Gear T-Connector',         '88073020', 'Unit',  null, 5, null, 12),
  ('Tank Mount',                       '88073020', 'Unit',  null, 5, null, 14),
  ('Rubber Sponge (Landing Gear)',     '88073020', 'Unit',  null, 5, null, 12),
  ('Nozzle Mount',                     null,        'Set',   null, 5, null, 1),
  ('Pushin Fitting - L Connector',     null,        'Unit',  null, 18, '12-10mm', 50),
  ('Pushin Fitting - T Connector (8-8-12)', null,   'Unit',  null, 18, '8-8-12mm', 50),
  ('Pushin Fitting - T Connector (8-8-10)', null,   'Unit',  null, 18, '8-8-10mm', 53),
  ('Pushin Fitting - T Connector (8-8-8)',  null,   'Unit',  null, 18, '8-8-8mm', 51),
  ('Pushin Fitting - S Connector',     null,        'Unit',  null, 18, '8-6mm', 50),
  ('Polyurethane (PU) Pipe (12-8mm)',  null,        'Meter', null, 18, '12-8mm', 104),
  ('Polyurethane (PU) Pipe (10-6mm)',  null,        'Meter', null, 18, '10-6mm', 103),
  ('Polyurethane (PU) Pipe (8-5mm)',   null,        'Meter', null, 18, '8-5mm', 105),
  ('Battery Plug Holder',              '88073000', 'Unit',  null, 5, null, 2),
  ('Power Cable XT-90',                null,        'Unit',  null, 18, null, 1),
  ('XT-90 Connector with Cap',         null,        'Piece', null, 18, null, 50),
  ('XT-60 Connector',                  null,        'Piece', null, 18, null, 50),
  -- New spare from the VAAYU 24000 advertisement (₹30,083.89 excl GST, 18% GST)
  ('Battery VAAYU 24000',              '85076000', 'Unit',  30083.89, 18, 'VAAYU 24000mAh 21.6V agriculture drone battery, BIS IS 16046 (Part 2), 400 cycles', 0)
) as v(name, hsn, unit, rate, gst, descr, stock)
where not exists (select 1 from public.spare_catalogue s where s.name = v.name);

-- ---------- DEFAULT BOM DESIGN (from the Drone Quotations Builder) ----------
insert into public.bom_designs (name, description, parts, overhead_pct, profit_pct, commission_pct)
select 'Standard Agri Drone (No Sensor) — 1 Set Battery',
       'Default BOM seeded from the Drone Quotations Builder. Rates are standard; edit per design.',
       '[
         {"part":"Frame","qty":1,"rate_excl":33999,"gst_rate":5},
         {"part":"Flight Controller","qty":1,"rate_excl":30499,"gst_rate":5},
         {"part":"Remote controller","qty":1,"rate_excl":17500,"gst_rate":5},
         {"part":"Motor","qty":6,"rate_excl":8950,"gst_rate":5},
         {"part":"Battery","qty":0,"rate_excl":27874,"gst_rate":18},
         {"part":"Propellor","qty":6,"rate_excl":600,"gst_rate":5},
         {"part":"Propellor Hub","qty":6,"rate_excl":402,"gst_rate":5},
         {"part":"Centrifugal Nozzle","qty":0,"rate_excl":5999,"gst_rate":5},
         {"part":"Nozzle","qty":4,"rate_excl":989,"gst_rate":5},
         {"part":"Spraying Kit","qty":1,"rate_excl":891.45,"gst_rate":5},
         {"part":"Terrain Radar","qty":0,"rate_excl":14999,"gst_rate":5},
         {"part":"Optical Radar","qty":0,"rate_excl":15299,"gst_rate":5},
         {"part":"CAN hub","qty":0,"rate_excl":6500,"gst_rate":5},
         {"part":"Pump","qty":1,"rate_excl":5000,"gst_rate":5},
         {"part":"Charger","qty":0,"rate_excl":17500,"gst_rate":18}
       ]'::jsonb,
       15, 10, 2
where not exists (select 1 from public.bom_designs b where b.name = 'Standard Agri Drone (No Sensor) — 1 Set Battery');
