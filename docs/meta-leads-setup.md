# Meta (Facebook / Instagram) Lead Ads → Leads tracker

Pulls **Lead Ad (Instant Form)** submissions into a review **inbox**
(`public.meta_leads_inbox`) via the `meta-leads-webhook` Edge Function. The BD
team sees them under **Leads → 📥 Meta inbox** and clicks **Transfer to DCB lead
tracker** to create the real lead (prefilled). They do NOT auto-merge into the
pipeline. (DM / WhatsApp chats are **not** covered — separate messaging APIs.)

## 1. Our side (code — already in the repo)
- `supabase/functions/meta-leads-webhook/index.ts` — the webhook.
- `sql/127_meta_leads.sql` — `meta_leads_inbox` (staging) + `meta_lead_config`. **Run it in Supabase.**
- In-app config: **Leads → ⚙ Meta leads** (admin) — default owner, enable/disable, last-sync, and the callback URL.

### Deploy
```bash
supabase functions deploy meta-leads-webhook --no-verify-jwt
supabase secrets set \
  DCB_SERVICE_KEY=<service-role key> \
  META_VERIFY_TOKEN=<any random string> \
  META_APP_SECRET=<meta app secret> \
  META_PAGE_TOKEN=<long-lived Page access token>
```
`--no-verify-jwt` is required — Meta calls the webhook without a Supabase JWT.
Callback URL: `https://<project-ref>.supabase.co/functions/v1/meta-leads-webhook`

## 2. Meta side (your Business/Developer account)
1. **Meta app** (developers.facebook.com) — type *Business*, linked to your Business Manager. Add the **Webhooks** and **Facebook Login / Pages** products.
2. **Permissions**: `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `ads_management` (as applicable). These need **App Review → Advanced Access** for production; you can test immediately with users who have a **role on the app** (admin/developer/tester).
3. **Page access token**: generate a token for the Page running the ads, then exchange it for a **long-lived** Page token (Graph API Explorer → "Extend"). Put it in `META_PAGE_TOKEN`.
4. **Webhooks → Page**: set the Callback URL + the same `META_VERIFY_TOKEN`; after it verifies, **subscribe the `leadgen` field**. Then **subscribe your Page** to the app (Webhooks "Subscribe" button for that Page).
5. **Privacy policy URL** on the app (Meta requires it for lead access).

## 3. Test
Use Meta's **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing) → pick the Page + form → *Create lead*. It should appear under **Leads → 📥 Meta inbox** within a few seconds. Click **Transfer to DCB lead tracker** to turn it into a tracked lead.

## Notes
- Dedupe is by Meta's `leadgen_id` (unique index) — re-deliveries are ignored.
- Custom form questions are folded into the lead's **Interest** field; the full payload is kept in `leads.meta_raw`.
- Instagram lead forms also arrive through the Page webhook; retag source in-app if needed.
- Token expiry: long-lived Page tokens are ~60 days unless the Page is tied to a system user with a non-expiring token — prefer a **System User** token for production.
