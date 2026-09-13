# admin-users — Edge Function deploy

Lets admins provision logins and read account activation from the HR portal.
Uses the service-role key (auto-injected by Supabase) — safe, because it runs on
Supabase's servers, not in the browser, and every call is admin-gated.

No secrets to set: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to
Edge Functions automatically.

## Deploy — Option A: Supabase CLI (recommended)
```bash
# one-time
npm i -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF     # ref is in the dashboard URL / Settings → General

# from the repo root (folder that contains supabase/functions/admin-users/)
supabase functions deploy admin-users
```

## Deploy — Option B: Dashboard
Supabase dashboard → **Edge Functions** → **Create a function** → name it exactly
`admin-users` → paste the contents of `index.ts` → **Deploy**.

Keep **"Verify JWT" ON** (default) — the app sends the signed-in user's token and
the function additionally checks that the caller is an admin.

## Verify
In the app, sign in as an admin → **HR → Employees** → open an employee → the
**Account access** panel should load a status (not the "service unavailable" note).

## What it does
- `status`  — account state per employee (has account / confirmed / last sign-in / linked)
- `create`  — makes a login with a temporary password; sets access type
  (internal My Space, or an external portal: vendor / authorized_partner /
  consultant / pilot); links the employee record
- `reset`   — sets a new temporary password

## Also do: turn off public self-signup
Dashboard → **Authentication → Sign In / Providers** (or **Settings**) →
disable **"Allow new users to sign up"**. Admin provisioning still works (it uses
the service role). The app's login screen already hides the "Create an account" link.
