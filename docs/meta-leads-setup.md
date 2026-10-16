# Meta (Facebook / Instagram) Lead Ads → Leads tracker — step-by-step

Pulls **Lead Ad (Instant Form)** submissions into a review **inbox**
(`public.meta_leads_inbox`). The BD team sees them under **Leads → 📥 Meta inbox**
and clicks **Transfer to DCB lead tracker**. They do NOT auto-merge. (DM / WhatsApp
chats are not covered — separate messaging APIs.)

Code already in the repo:
- `supabase/functions/meta-leads-webhook/index.ts` — the webhook
- `sql/127_meta_leads.sql` — `meta_leads_inbox` + `meta_lead_config` (run in Supabase)
- In-app admin card: **Leads → ⚙ Meta leads**

Prerequisites: a running **Lead Ad / Instant Form** on the Page; you are an **admin**
of that Page and of Business Manager; a **Meta developer account**.

The 4 secrets you will collect: `DCB_SERVICE_KEY`, `META_VERIFY_TOKEN` (you invent),
`META_APP_SECRET`, `META_PAGE_TOKEN`.

## STAGE 1 — Create the Meta app
1. https://developers.facebook.com → **Log In** (the FB account that admins the Page).
2. First time: **Get Started** → accept developer terms.
3. **My Apps** (https://developers.facebook.com/apps) → **Create App**.
4. "What do you want to do?" → **Other** → **Next**.
5. App type → **Business** → **Next**.
6. Name `DCB Leads`, your email, pick the DroCon **Business portfolio** → **Create app**.

## STAGE 2 — App ID + App Secret
7. Left sidebar → **App settings → Basic**.
8. Copy **App ID**. Beside **App secret** → **Show** → copy → `META_APP_SECRET`.
9. Fill **Privacy Policy URL** + **Category** → **Save changes**.

## STAGE 3 — System User + non-expiring Page token
10. https://business.facebook.com/settings (correct business selected).
11. **Users → System Users → Add** → name `DCB Leads Bot`, role **Admin** → **Create**.
12. **Add Assets → Apps** → tick `DCB Leads` → enable **Manage app** → Save.
13. **Add Assets → Pages** → tick your Page → enable **Manage Page** (full control) → Save.
14. **Generate New Token** → app `DCB Leads` → scopes: `pages_show_list`,
    `pages_read_engagement`, `pages_manage_metadata`, `leads_retrieval` →
    **Generate** → copy → `META_PAGE_TOKEN`.
    - If `leads_retrieval` is greyed out, do STAGE 6 first, or use the quick token:

### STAGE 3-alt — quick test token (expires ~2 months)
https://developers.facebook.com/tools/explorer → pick the `DCB Leads` app →
**Get Page Access Token** → your Page → add perms `pages_show_list,
pages_read_engagement, leads_retrieval` → copy → use as `META_PAGE_TOKEN`.

## STAGE 4 — Deploy webhook + secrets (Supabase)
15. https://supabase.com/dashboard → project → **Project Settings → API** → copy
    the **service_role** secret → `DCB_SERVICE_KEY`.
16. Invent `META_VERIFY_TOKEN` (any random string, e.g. `dcb-meta-9F3kQ`).
17. Terminal (same setup `admin-users` was deployed from):
```bash
supabase functions deploy meta-leads-webhook --no-verify-jwt
supabase secrets set DCB_SERVICE_KEY=... META_VERIFY_TOKEN=... META_APP_SECRET=... META_PAGE_TOKEN=...
```
18. App → **Leads → ⚙ Meta leads** → copy the **Callback URL**
    (`https://<project-ref>.supabase.co/functions/v1/meta-leads-webhook`).

## STAGE 5 — Webhook in Meta
19. App Dashboard → **+ Add product → Webhooks → Set up**.
20. Object dropdown → **Page** → **Subscribe to this object**.
21. Callback URL = step 18; Verify Token = `META_VERIFY_TOKEN` → **Verify and Save** (green ✓).
22. In the Page field list → **leadgen** → **Subscribe**.

## STAGE 6 — Subscribe the Page + request permission
23. Subscribe the Page: https://developers.facebook.com/tools/lead-ads-testing →
    select Page → **Subscribe** if prompted. (Or Graph Explorer:
    `POST /<PAGE_ID>/subscribed_apps?subscribed_fields=leadgen`.)
24. Production only: **App Review → Permissions and Features → leads_retrieval →
    Request Advanced Access** (screencast + privacy URL). Before approval it works
    for anyone with a **role on the app** (admins/testers) — enough to test.

## STAGE 7 — Configure + test
25. App → **Leads → ⚙ Meta leads** → set **Default owner**, **enabled** → Save.
26. https://developers.facebook.com/tools/lead-ads-testing → Page + form →
    **Create lead** → **Submit**.
27. App → **Leads → 📥 Meta inbox** → the test lead appears (New); the ⚙ card
    "Last webhook event / Last lead received" update.

## Troubleshooting
- **Verify and Save fails** → token mismatch, or not deployed with `--no-verify-jwt`.
- **Event received (⚙ shows a time) but no lead** → Page token wrong/expired or missing
  `leads_retrieval`. Read logs: `supabase functions logs meta-leads-webhook`.
- **Nothing at all** → Page not subscribed, or `leadgen` field not subscribed.
- Token lifetime: prefer the **System User** token (non-expiring) for production.
