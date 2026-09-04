// Verify the Supabase login token the app already holds, so only signed-in
// DroCon users can reach the mail API — and each request is scoped to that user.
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET || "");

export async function requireUser(req, reply) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) { reply.code(401).send({ error: "missing token" }); return null; }
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (!payload.sub) { reply.code(401).send({ error: "invalid token" }); return null; }
    return { id: payload.sub, email: payload.email || "" };
  } catch (e) {
    reply.code(401).send({ error: "invalid token" });
    return null;
  }
}
