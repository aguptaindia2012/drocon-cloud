// ============================================================================
// DroCon Cloud — admin-users Edge Function
// Lets an ADMIN provision logins and read account activation from the HR portal.
// Uses the service-role key (auto-injected by Supabase) to call the Auth admin
// API — which cannot run safely in the browser. Every call is admin-gated.
//
// Actions (POST JSON { action, ... }):
//   status  { employee_id? }            -> account status for one/all employees
//   create  { employee_id, email, full_name, access } -> make a login (temp pw)
//   reset   { employee_id? | email | user_id }        -> reset to a new temp pw
//
// access: "internal" (My Space + internal tabs) | "vendor" | "authorized_partner"
//         | "consultant" | "pilot" | "client"  (all but internal are external portals).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
// Prefer an explicitly-set secret (DCB_SERVICE_KEY) because on projects using the
// new API-key system the reserved SUPABASE_SERVICE_ROLE_KEY may be empty.
const SERVICE = Deno.env.get("DCB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EXTERNAL = new Set(["vendor", "authorized_partner", "consultant", "pilot", "client"]);

// Report which role the configured key maps to (for diagnostics) without leaking it.
function keyRole(k: string): string {
  if (!k) return "EMPTY";
  if (k.startsWith("sb_secret")) return "sb_secret";
  if (k.startsWith("sb_publishable")) return "sb_publishable";
  try {
    const p = JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.role || "unknown-jwt";
  } catch {
    return "unknown";
  }
}

function genPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

async function listAllAuthUsers() {
  const out: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return out;
}

async function handleStatus(body: any) {
  const users = await listAllAuthUsers();
  const byEmail = new Map(users.map((u) => [(u.email || "").trim().toLowerCase(), u]));
  const byId = new Map(users.map((u) => [u.id, u]));

  // Preferred: status by email (works for any register — employee/vendor/pilot/consultant)
  if (body.email) {
    const u = byEmail.get((body.email || "").trim().toLowerCase());
    let prof: any = null;
    if (u) {
      const { data } = await admin.from("profiles").select("role,is_external,party_type,party_id").eq("id", u.id).maybeSingle();
      prof = data;
    }
    return json(200, { rows: [{
      email: body.email,
      has_account: !!u,
      confirmed: !!(u && (u.email_confirmed_at || u.confirmed_at)),
      last_sign_in_at: u ? u.last_sign_in_at : null,
      user_id: u ? u.id : null,
      is_external: prof?.is_external ?? null,
      party_type: prof?.party_type ?? null,
      party_id: prof?.party_id ?? null,
    }] });
  }

  // Fallback: by employee_id / all (legacy)
  let q = admin.from("employees").select("id,name,email,user_id");
  if (body.employee_id) q = q.eq("id", body.employee_id);
  const { data: emps, error } = await q;
  if (error) return json(500, { error: error.message });
  const rows = (emps || []).map((e: any) => {
    const u = e.email ? byEmail.get((e.email || "").trim().toLowerCase()) : (e.user_id ? byId.get(e.user_id) : null);
    return {
      employee_id: e.id, name: e.name, email: e.email,
      has_account: !!u,
      confirmed: !!(u && (u.email_confirmed_at || u.confirmed_at)),
      last_sign_in_at: u ? u.last_sign_in_at : null,
      linked: !!e.user_id,
      user_id: u ? u.id : null,
    };
  });
  return json(200, { rows });
}

async function applyAccess(userId: string, access: string, partyId: string | null) {
  const is_external = EXTERNAL.has(access);
  const patch: any = { is_external };
  if (is_external) { patch.party_type = access; patch.party_id = partyId ?? null; }
  await admin.from("profiles").update(patch).eq("id", userId);
}

async function handleCreate(body: any) {
  const email = (body.email || "").trim().toLowerCase();
  const access = body.access || "internal";
  const partyId = body.party_id ?? null;
  if (!email) return json(400, { error: "email required" });

  const users = await listAllAuthUsers();
  const existing = users.find((u) => (u.email || "").trim().toLowerCase() === email);

  let userId: string;
  let tempPassword: string | null = null;
  if (existing) {
    userId = existing.id;
  } else {
    const password = genPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: body.full_name || "" },
    });
    if (error) return json(400, { error: error.message });
    userId = data.user.id;
    tempPassword = password;
  }

  await applyAccess(userId, access, partyId);
  // internal employees also link via employees.user_id (My Space)
  if (access === "internal" && body.employee_id) {
    await admin.from("employees").update({ user_id: userId, email }).eq("id", body.employee_id);
  }

  return json(200, { created: !existing, user_id: userId, email, access, party_id: partyId, temp_password: tempPassword });
}

async function handleReset(body: any) {
  let userId = body.user_id as string | undefined;
  if (!userId) {
    let email = (body.email || "").trim().toLowerCase();
    if (!email && body.employee_id) {
      const { data: e } = await admin.from("employees").select("email").eq("id", body.employee_id).maybeSingle();
      email = (e?.email || "").trim().toLowerCase();
    }
    if (!email) return json(400, { error: "email or user_id required" });
    const users = await listAllAuthUsers();
    userId = users.find((u) => (u.email || "").trim().toLowerCase() === email)?.id;
    if (!userId) return json(404, { error: "no account for that email" });
  }
  const password = genPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return json(400, { error: error.message });
  return json(200, { temp_password: password });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  try {
    if (!SERVICE) return json(500, { error: "service key not configured — set the DCB_SERVICE_KEY secret" });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing token" });
    const { data: caller, error: cerr } = await admin.auth.getUser(jwt);
    if (cerr || !caller?.user) return json(401, { error: "invalid token" });
    const { data: prof, error: perr } = await admin.from("profiles").select("role,is_external").eq("id", caller.user.id).maybeSingle();
    if (!prof || prof.role !== "admin" || prof.is_external) {
      return json(403, { error: "admin only", detail: { has_profile: !!prof, role: prof?.role ?? null, is_external: prof?.is_external ?? null, uid: caller.user.id, read_error: perr?.message ?? null, service_key_role: keyRole(SERVICE), code_version: "v3" } });
    }

    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "status": return await handleStatus(body);
      case "create": return await handleCreate(body);
      case "reset": return await handleReset(body);
      default: return json(400, { error: "unknown action" });
    }
  } catch (e) {
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
