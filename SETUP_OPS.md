# DroCon Cloud — Operations Suite · Setup, Hosting & Install

This is the expanded DroCon app: the original **Agreement Studio** plus the new
**Order Management** and **Administration** sections (billing, catalogues,
inventory, BOM calculator, receivables — Phase 1; field trackers & pools follow
in Phases 2–3). It is a **static site + Supabase**, free to run, installable on
Windows and Android.

---

## 1. Create the database (Supabase — free)
1. Go to <https://supabase.com> → **New project** (no card needed). Pick a region near you; save the database password.
2. Open **Project → SQL Editor → New query**. Run these files **in order** (paste each, click **Run**):
   1. `sql/00_schema_agreements.sql`  *(agreements, profiles, roles, audit)*
   2. `sql/01_migrate_v2.sql`
   3. `sql/02_migrate_v3_visibility.sql`
   4. `sql/03_migrate_v4_ops.sql`     *(clients, vendors, documents, inventory, etc.)*
   5. `sql/04_seed_catalogues.sql`    *(spares incl. Battery VAAYU, agri-spray rates, default BOM)*
3. For quick testing: **Authentication → Providers → Email → turn OFF "Confirm email"** so new sign-ups log in immediately. (Turn it back on later for production.)

## 2. Point the app at your project
1. **Project → Settings → API.** Copy the **Project URL** and the **anon public** key.
2. In this folder, copy `config.example.js` to **`config.js`** and paste both values:
   ```js
   window.DCB_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...the anon public key..."
   };
   ```
   The anon key is **safe to ship in the browser** — Row Level Security in the database is what protects the data.

## 3. Run it on your laptop
**Option A — one click (Windows):** double-click `server.ps1`
(or run `powershell -ExecutionPolicy Bypass -File server.ps1`), then open
<http://localhost:8765/>.
**Option B — VS Code:** install the *Live Server* extension, right-click
`index.html` → *Open with Live Server*.

> Open over `http://…`, not by double-clicking the HTML file, so the browser allows the service worker and modules.

**First sign-up becomes the admin.** Create your account, then go to
**Agreement → Team & access** to set roles and tick which **Administration**
tools each teammate may use.

## 4. Put it online (free) so the team and your phone can use it
Pick one:

**Cloudflare Pages (easiest):** <https://pages.cloudflare.com> → *Create project*
→ *Direct upload* → drag this whole `DroCon-Cloud` folder → Deploy. You get a
`https://your-app.pages.dev` URL. (Re-upload to update.)

**GitHub Pages:** create a repo, push this folder, then *Settings → Pages →
Deploy from branch → main → /(root)*. Your URL is `https://<user>.github.io/<repo>/`.

> Keep `config.js` with the app (the anon key is meant to be public). Do **not** put the Supabase **service_role** key anywhere in the front-end.

## 5. Install as an app (Windows + Android)
The site is a PWA (manifest + service worker + icons are included).
- **Windows (Edge/Chrome):** open the hosted URL → click the **Install** icon in the address bar (or ⋮ → *Apps → Install this site as an app*). It gets a Start-menu shortcut and its own window.
- **Android (Chrome):** open the URL → **⋮ → Add to Home screen / Install app**.
- **iPhone (Safari):** *Share → Add to Home Screen*.

---

## What's in each section
- **Agreement** — the original studio: draft → review → approve → execute, shared templates, audit, **Team & access** (roles + per-tool grants).
- **Order Management** — **Clients** pool, **Authorized Partners** pool (Order Tracker & Pilot Tracker arrive in Phase 3).
- **Administration** (per-tool access, granted by admin):
  - **Quotation** — filled afresh, independent of the Clients registry.
  - **Invoice** — pulls the buyer from Clients; Original/Duplicate copies; HSN/SAC; optional stock reduction for spare lines.
  - **Credit Note** — built on the invoice layout, links to an invoice, basic terms.
  - **Purchase Order** — pulls the vendor; **auto-suggested next PO number**; editable Terms & Conditions.
  - **Vendors**, **Service & Spares** catalogues, **Inventory**, **BOM Calculator**, **Invoices & Receivables** (aging dashboard).
  - **Acre Tracker / Farmer Tracker / Dashboards** — slots are present; built in Phases 2–3.

## Documents (Word + JSON)
Every billing document offers **⬇ Download Word (.docx)** and **⬇ Download JSON**.
- The Word file carries the **DroCon letterhead in the page header, so it repeats on every page** automatically. Open it in Word; *File → Save As → PDF* if you need a PDF.
- The **JSON** is the retrievable draft — keep it, or use **Import JSON…** to reopen a document later and regenerate it.
- Numbering follows the house style and auto-increments per financial year: Invoice/Quotation `DCB/26-27/0001`, Credit Note `DCB/CN/26-27/0001`, PO `DCB26-270001`. The suggested number is editable before saving.

## Bringing in old data
Clients, Vendors, Authorized Partners, and the catalogues each have **Import CSV**
(and **Export CSV**). Export once to see the exact column headers, fill old rows
to match, and import. New-only fields can be left blank for legacy rows. (Acre &
Farmer history import arrives with those trackers in Phase 2.)

## Notes
- **Free tier:** Supabase gives ~500 MB Postgres, daily backups, TLS in transit, AES-256 at rest. Cloudflare/GitHub Pages hosting is free. Move to a paid Supabase tier only when data grows.
- **Security:** the browser uses the anon key only; all access rules are enforced by Postgres Row Level Security, so they can't be bypassed from the browser.
- `server.ps1` is only for local testing — it is not used by the hosted site.
