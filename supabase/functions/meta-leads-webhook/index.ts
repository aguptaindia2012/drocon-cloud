// ============================================================================
// DroCon Cloud — meta-leads-webhook Edge Function
// Receives Facebook / Instagram LEAD ADS (Instant Form) submissions from Meta
// and inserts them into public.meta_leads_inbox (the team transfers them into
// the tracker from the app). Lead Ads only — not DM/WhatsApp.
//
//   GET  … hub.challenge  -> webhook verification handshake (no DB needed)
//   POST … leadgen events -> verify signature, fetch each lead via Graph API
//          (Page token), map fields, upsert into meta_leads_inbox (dedupe by
//          meta_lead_id). Always replies 200 so Meta doesn't retry-storm.
//
// Secrets: DCB_SERVICE_KEY, META_VERIFY_TOKEN, META_APP_SECRET, META_PAGE_TOKEN
//          (SUPABASE_URL is provided by the platform).
// ============================================================================
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SBURL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("DCB_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") || "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const PAGE_TOKEN = Deno.env.get("META_PAGE_TOKEN") || "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v21.0";

// lazy client — created only when actually needed (never on the GET handshake)
let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_db) _db = createClient(SBURL, SERVICE, { auth: { persistSession: false } });
  return _db;
}

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha256Hex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}
function cleanPhone(s: string | null) {
  if (!s) return null;
  const d = String(s).replace(/[^\d]/g, "").replace(/^0+/, "");
  return d || null;
}

function mapLead(fieldData: any[]) {
  const get = (names: string[]) => {
    for (const f of fieldData || []) {
      const n = String(f.name || "").toLowerCase();
      if (names.some((x) => n === x || n.includes(x))) return (f.values && f.values[0]) || null;
    }
    return null;
  };
  const name = get(["full_name", "name"]) ||
    [get(["first_name"]), get(["last_name"])].filter(Boolean).join(" ") || null;
  const phone = cleanPhone(get(["phone_number", "phone", "mobile"]));
  const email = get(["email"]);
  const city = get(["city", "town"]);
  const std = new Set(["full_name", "name", "first_name", "last_name", "phone_number", "phone", "mobile", "email", "city", "town"]);
  const extras = (fieldData || [])
    .filter((f) => !std.has(String(f.name || "").toLowerCase()))
    .map((f) => `${f.name}: ${(f.values || []).join(", ")}`);
  const interest = extras.join(" · ") || null;
  return { name, phone, email, city, interest };
}

async function fetchLead(leadId: string) {
  const u = `https://graph.facebook.com/${GRAPH}/${leadId}?access_token=${encodeURIComponent(PAGE_TOKEN)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Graph ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function handleLeadgen(value: any) {
  const leadId = value.leadgen_id || value.lead_id;
  if (!leadId) return;
  const { data: cfg } = await db().from("meta_lead_config").select("*").eq("id", 1).maybeSingle();
  if (cfg && cfg.enabled === false) return;

  const lead = await fetchLead(String(leadId));
  const m = mapLead(lead.field_data || []);
  const row = {
    meta_lead_id: String(leadId),
    meta_form_id: value.form_id ? String(value.form_id) : (lead.form_id ? String(lead.form_id) : null),
    meta_page_id: value.page_id ? String(value.page_id) : null,
    name: m.name, phone: m.phone, email: m.email, city: m.city, interest: m.interest,
    raw: lead, status: "new",
  };
  await db().from("meta_leads_inbox").upsert(row, { onConflict: "meta_lead_id", ignoreDuplicates: true });
  await db().from("meta_lead_config").update({ last_lead_at: new Date().toISOString() }).eq("id", 1);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ---- webhook verification handshake (GET) — no DB, no secrets beyond verify token
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
      return new Response(challenge || "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const raw = await req.text();
  // ---- verify payload signature ----
  try {
    const sig = (req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
    if (APP_SECRET) {
      const expect = await hmacSha256Hex(APP_SECRET, raw);
      if (!sig || sig.length !== expect.length || sig !== expect) {
        return new Response("bad signature", { status: 401 });
      }
    }
  } catch (_e) {
    return new Response("bad signature", { status: 401 });
  }

  // ---- process leadgen events (best-effort; always 200) ----
  try {
    const body = JSON.parse(raw || "{}");
    await db().from("meta_lead_config").update({ last_event_at: new Date().toISOString() }).eq("id", 1);
    for (const entry of body.entry || []) {
      for (const ch of entry.changes || []) {
        if (ch.field === "leadgen" && ch.value) {
          try { await handleLeadgen(ch.value); } catch (e) { console.error("lead error", String(e)); }
        }
      }
    }
  } catch (e) {
    console.error("webhook error", String(e));
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
});
