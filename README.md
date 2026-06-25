# DroCon Cloud — Operations Suite

Static web app (no build step) + Supabase backend. Extends the DroCon Bharat
Agreement Studio with **Order Management** and **Administration** sections.

**Start here → [SETUP_OPS.md](SETUP_OPS.md)** (database, config, local run, hosting, install).

## Layout
```
index.html            App shell: auth + two-level nav (Agreement / Order Mgmt / Administration)
app.js                Boot, auth, profile, per-tool permissions, router, helpers
logo.js               DroCon logo (data URL) for Word headers
docgen.js             Word (.docx, letterhead-per-page) + JSON document engine
agreement.js          Agreement section (the original Studio views)
studio.html           Embedded agreement document editor (iframe)
modules/
  _shared.js          CSV + generic searchable registry factory
  clients.js          Clients pool + Authorized Partners pool
  vendors.js          Vendors registry
  catalogues.js       Service & Spare catalogues
  inventory.js        Stock + moves (trigger-backed)
  bom.js              BOM / Quotation calculator
  billing.js          Quotation / Invoice / Credit Note / Purchase Order
  receivables.js      Invoice tracker + receivables aging
sql/                  Run 00 → 04 in Supabase SQL editor (see SETUP_OPS.md)
config.example.js     Copy to config.js and add your Supabase URL + anon key
server.ps1            Local static server for testing (not used in production)
```

## Build phases
- **Phase 1 (this release):** billing core — Clients, Vendors, catalogues (incl. Battery VAAYU + agri-spray rates), Inventory, BOM, Quotation/Invoice/Credit Note/PO, Receivables.
- **Phase 2:** Acre Tracker, Farmer Tracker (nav slots present).
- **Phase 3:** Order Tracker pool, Authorized Partner search, output dashboards.
