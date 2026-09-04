// DroCon mail backend — HTTPS API the static app calls.
// Each route is scoped to the signed-in user's own mailbox.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { requireUser } from "./auth.js";
import { getAccount, getAccountWithPassword, saveAccount, deleteAccount, setError } from "./store.js";
import * as mail from "./mail.js";

const app = Fastify({ bodyLimit: 30 * 1024 * 1024 }); // 30MB for attachments
await app.register(cors, {
  origin: (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
  methods: ["GET", "POST", "DELETE"], allowedHeaders: ["authorization", "content-type"],
});

const D = {
  imap_host: process.env.DEFAULT_IMAP_HOST || "imap.hostinger.com",
  imap_port: Number(process.env.DEFAULT_IMAP_PORT || 993),
  smtp_host: process.env.DEFAULT_SMTP_HOST || "smtp.hostinger.com",
  smtp_port: Number(process.env.DEFAULT_SMTP_PORT || 465),
};

app.get("/health", async () => ({ ok: true }));

// helper: load the user's mailbox creds or 409 if not connected
async function acctOr409(user, reply) {
  const a = await getAccountWithPassword(user.id);
  if (!a) { reply.code(409).send({ error: "not_connected" }); return null; }
  return a;
}

// ---- connection management ----
app.post("/mail/connect", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const b = req.body || {};
  const email = (b.email || user.email || "").trim();
  const password = b.password || "";
  if (!email || !password) return reply.code(400).send({ error: "email and password required" });
  const acct = {
    email, password,
    imap_host: (b.imap_host || D.imap_host).trim(), imap_port: Number(b.imap_port || D.imap_port),
    smtp_host: (b.smtp_host || D.smtp_host).trim(), smtp_port: Number(b.smtp_port || D.smtp_port),
  };
  try {
    await mail.verifyLogin(acct);
  } catch (e) {
    return reply.code(401).send({ error: "login_failed", detail: String(e.message || e).slice(0, 200) });
  }
  await saveAccount(user.id, acct);
  return { connected: true, email };
});

app.get("/mail/status", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const a = await getAccount(user.id);
  return a ? { connected: true, email: a.email, status: a.status, last_error: a.last_error } : { connected: false };
});

app.delete("/mail/disconnect", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  await deleteAccount(user.id);
  return { connected: false };
});

// ---- receive ----
app.get("/mail/mailboxes", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const a = await acctOr409(user, reply); if (!a) return;
  try { return { mailboxes: await mail.listMailboxes(a) }; }
  catch (e) { await setError(user.id, e.message); return reply.code(502).send({ error: "imap_error", detail: String(e.message).slice(0, 200) }); }
});

app.get("/mail/messages", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const a = await acctOr409(user, reply); if (!a) return;
  const mailbox = req.query.mailbox || "INBOX";
  const limit = Math.min(Number(req.query.limit || 30), 100);
  const beforeSeq = req.query.before ? Number(req.query.before) : null;
  try { return await mail.listMessages(a, mailbox, { limit, beforeSeq }); }
  catch (e) { await setError(user.id, e.message); return reply.code(502).send({ error: "imap_error", detail: String(e.message).slice(0, 200) }); }
});

app.get("/mail/message", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const a = await acctOr409(user, reply); if (!a) return;
  const { mailbox = "INBOX", uid } = req.query;
  if (!uid) return reply.code(400).send({ error: "uid required" });
  try {
    const m = await mail.getMessage(a, mailbox, uid, { markSeen: req.query.markSeen !== "0" });
    return m || reply.code(404).send({ error: "not_found" });
  } catch (e) { return reply.code(502).send({ error: "imap_error", detail: String(e.message).slice(0, 200) }); }
});

app.get("/mail/attachment", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const a = await acctOr409(user, reply); if (!a) return;
  const { mailbox = "INBOX", uid, index = 0 } = req.query;
  if (!uid) return reply.code(400).send({ error: "uid required" });
  try {
    const att = await mail.getAttachment(a, mailbox, uid, index);
    if (!att) return reply.code(404).send({ error: "not_found" });
    reply.header("Content-Type", att.contentType);
    reply.header("Content-Disposition", `attachment; filename="${(att.filename || "file").replace(/"/g, "")}"`);
    return reply.send(att.content);
  } catch (e) { return reply.code(502).send({ error: "imap_error", detail: String(e.message).slice(0, 200) }); }
});

app.post("/mail/flags", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const a = await acctOr409(user, reply); if (!a) return;
  const { mailbox = "INBOX", uid, seen } = req.body || {};
  if (!uid) return reply.code(400).send({ error: "uid required" });
  try { await mail.setFlags(a, mailbox, uid, { seen }); return { ok: true }; }
  catch (e) { return reply.code(502).send({ error: "imap_error", detail: String(e.message).slice(0, 200) }); }
});

// ---- send ----
app.post("/mail/send", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const a = await acctOr409(user, reply); if (!a) return;
  const b = req.body || {};
  if (!b.to || (!b.subject && !b.text && !b.html)) return reply.code(400).send({ error: "to + content required" });
  try {
    const r = await mail.sendMail(a, {
      to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject || "(no subject)",
      text: b.text, html: b.html, inReplyTo: b.inReplyTo, references: b.references,
      attachments: b.attachments, // [{filename, content_type, content_base64}]
    });
    return { sent: true, ...r };
  } catch (e) { return reply.code(502).send({ error: "smtp_error", detail: String(e.message).slice(0, 200) }); }
});

const port = Number(process.env.PORT || 8091);
app.listen({ port, host: "127.0.0.1" }).then(() => {
  app.log.info(`mail backend on 127.0.0.1:${port}`);
}).catch(err => { app.log.error(err); process.exit(1); });
