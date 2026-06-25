# DroCon Cloud — Security & Data Privacy

This app holds personal information (PII). This document states what is stored,
how it is protected, who can access it, and the few settings you must enable in
the Supabase dashboard.

## What personal data is held
| Data | Where | Sensitivity |
|---|---|---|
| Staff login email, name, role | `auth.users`, `profiles` | medium |
| Client / Vendor name, phone, email, GSTIN, address | `clients`, `vendors`, `documents.party_snapshot` | medium |
| Farmer name, **phone number**, village | `farmer_sprays` | **high** |
| Pilot name, phone, **home GPS** | `authorized_partners` | medium-high |
| **Employee salary, bank details** | `employees`, `salary_runs`, `salary_payments`, `accounting_entries` | **high** |

## How it is protected
- **Encryption:** TLS in transit (HTTPS everywhere); AES-256 at rest (Supabase).
- **Authentication:** Supabase Auth. Sign-up is **restricted to @droconbharat.com / @ibsideas.com** (DB trigger). Not-signed-in users have **zero** data access.
- **Row-Level Security (enforced by the database, not the browser):**
  - Business data (clients, vendors, documents, orders, partners, acre) — readable by signed-in staff (small-team model).
  - **HR / payroll (salaries, bank details)** — readable/writable only by **admins or staff granted an HR tool** (`sql/10`). An intern or pilot **cannot** read salaries via the app *or* the API.
  - **Farmer data (names, phone numbers)** — only **admins or staff granted the Farmer Tracker**.
  - Per-tool access in **Team & Access** is now a real security boundary, not just a UI toggle.
- **Keys:** the browser uses only the **publishable/anon key** (safe to expose). The **service_role key is never in the front-end or the repo** — keep it secret; if it ever leaks, rotate it in Supabase → Settings → API.
- **Client device:** the offline cache (service worker) caches only the app shell — it **never caches Supabase data**. Word/JSON document downloads are user-initiated and saved where the user chooses.

## Settings you must enable in Supabase (one-time, for production)
1. **Authentication → Sign In / Providers → Email → Confirm email = ON.** (You turned it off for testing; turn it back on so only real, verified company emails get in.)
2. **Authentication → Policies / Password:** set **minimum length ≥ 8** and enable **Leaked password protection**.
3. **Authentication → URL Configuration → Site URL =** `https://aguptaindia2012.github.io/drocon-cloud/`.
4. **Keep RLS ON** for every table (never disable it).
5. (Recommended) Enable **MFA** for admin accounts once the team is settled.
6. Backups: the free tier keeps **daily backups**; upgrade later for point-in-time recovery if needed.

## Access requests & deletion (data-subject handling)
- To remove a person's data: delete their row in the relevant table (cascades remove linked rows). To remove a *user*, delete them in **Authentication → Users** — their `profiles` row is removed automatically (cascade).
- Salary/bank records: only an **admin** can delete (`sql/10`).

## Operational rules for the team
- Never paste the **service_role** key anywhere client-side or into chat/code.
- Grant each person only the tools they need in **Team & Access** (least privilege) — this now also limits what they can read from the database.
- Treat exported Word/JSON files (which contain party PII) like any confidential document.

## Reducing exposure further (optional, on request)
- Restrict `clients`/`vendors`/`documents` the same way HR is restricted (tie reads to the matching per-tool grant).
- Mask phone numbers in list views for users without an explicit "view contact" grant.
- Add an access-log of who viewed which sensitive record.
Ask and I'll implement any of these.
