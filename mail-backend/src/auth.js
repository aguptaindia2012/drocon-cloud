// Verify the Supabase login token the app holds, so only signed-in DroCon users
// reach the mail API. We validate the token against Supabase's auth server (via
// getUser) rather than checking a local JWT secret — this works regardless of
// whether the project signs tokens with the legacy secret or the new keys.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

export async function requireUser(req, reply) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) { reply.code(401).send({ error: "missing token" }); return null; }
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) { reply.code(401).send({ error: "invalid token" }); return null; }
    return { id: data.user.id, email: data.user.email || "" };
  } catch (e) {
    reply.code(401).send({ error: "invalid token" });
    return null;
  }
}
