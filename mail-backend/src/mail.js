// IMAP (receive) via imapflow + SMTP (send) via nodemailer.
// A fresh connection is opened per request and closed after — simple and safe.
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";

function imapClient(acct) {
  return new ImapFlow({
    host: acct.imap_host, port: Number(acct.imap_port) || 993, secure: true,
    auth: { user: acct.email, pass: acct.password }, logger: false,
    // give slow shared hosts room; fail rather than hang forever
    socketTimeout: 30000,
  });
}
function smtpTransport(acct) {
  const port = Number(acct.smtp_port) || 465;
  return nodemailer.createTransport({
    host: acct.smtp_host, port, secure: port === 465,
    auth: { user: acct.email, pass: acct.password },
  });
}

// Validate credentials by logging into BOTH IMAP and SMTP.
export async function verifyLogin(acct) {
  const c = imapClient(acct);
  await c.connect();
  await c.logout();
  await smtpTransport(acct).verify();
  return true;
}

export async function listMailboxes(acct) {
  const c = imapClient(acct);
  await c.connect();
  try {
    const boxes = [];
    for await (const b of c.list()) {
      boxes.push({ path: b.path, name: b.name, specialUse: b.specialUse || null,
        subscribed: b.subscribed !== false });
    }
    return boxes;
  } finally { await c.logout().catch(() => {}); }
}

// List envelope summaries for a mailbox, newest first, paged by sequence.
export async function listMessages(acct, mailbox = "INBOX", { limit = 30, beforeSeq = null } = {}) {
  const c = imapClient(acct);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const total = c.mailbox.exists || 0;
      if (!total) return { total: 0, messages: [] };
      const hi = beforeSeq ? Math.min(beforeSeq - 1, total) : total;
      const lo = Math.max(1, hi - limit + 1);
      if (hi < 1) return { total, messages: [] };
      const out = [];
      for await (const m of c.fetch(`${lo}:${hi}`, { envelope: true, flags: true, size: true, uid: true })) {
        out.push({
          seq: m.seq, uid: m.uid, size: m.size,
          flags: [...(m.flags || [])],
          seen: (m.flags || new Set()).has("\\Seen"),
          subject: m.envelope?.subject || "(no subject)",
          from: (m.envelope?.from || []).map(a => ({ name: a.name || "", address: a.address || "" })),
          to: (m.envelope?.to || []).map(a => ({ name: a.name || "", address: a.address || "" })),
          date: m.envelope?.date || null,
        });
      }
      out.sort((a, b) => b.seq - a.seq); // newest first
      return { total, messages: out };
    } finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }
}

// Full message (parsed) by UID, incl. attachment metadata (not the bytes).
export async function getMessage(acct, mailbox, uid, { markSeen = true } = {}) {
  const c = imapClient(acct);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const msg = await c.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      if (markSeen) { try { await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch {} }
      return {
        uid: Number(uid),
        subject: parsed.subject || "(no subject)",
        from: parsed.from?.value || [],
        to: parsed.to?.value || [],
        cc: parsed.cc?.value || [],
        date: parsed.date || null,
        messageId: parsed.messageId || null,
        html: parsed.html || null,
        text: parsed.text || "",
        attachments: (parsed.attachments || []).map((a, i) => ({
          index: i, filename: a.filename || `attachment-${i}`,
          contentType: a.contentType || "application/octet-stream",
          size: a.size || (a.content ? a.content.length : 0),
        })),
      };
    } finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }
}

// Return one attachment's bytes (Buffer) by index.
export async function getAttachment(acct, mailbox, uid, index) {
  const c = imapClient(acct);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      const a = (parsed.attachments || [])[Number(index)];
      if (!a) return null;
      return { filename: a.filename || `attachment-${index}`, contentType: a.contentType || "application/octet-stream", content: a.content };
    } finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }
}

export async function setFlags(acct, mailbox, uid, { seen } = {}) {
  const c = imapClient(acct);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(mailbox);
    try {
      if (seen === true) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      if (seen === false) await c.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
      return true;
    } finally { lock.release(); }
  } finally { await c.logout().catch(() => {}); }
}

// Send a message; also append a copy to the Sent mailbox (best-effort).
export async function sendMail(acct, { to, cc, bcc, subject, text, html, inReplyTo, references, attachments }) {
  const info = await smtpTransport(acct).sendMail({
    from: acct.email, to, cc, bcc, subject,
    text: text || undefined, html: html || undefined,
    inReplyTo: inReplyTo || undefined,
    references: references || undefined,
    attachments: (attachments || []).map(a => ({
      filename: a.filename, content: Buffer.from(a.content_base64 || "", "base64"), contentType: a.content_type })),
  });
  // append to Sent (folder name varies: Sent / Sent Items)
  try {
    const c = imapClient(acct);
    await c.connect();
    let sent = "Sent";
    for await (const b of c.list()) { if (b.specialUse === "\\Sent") { sent = b.path; break; } }
    const raw = info.message || null; // nodemailer may not return raw; skip if absent
    if (raw) await c.append(sent, raw, ["\\Seen"]);
    await c.logout().catch(() => {});
  } catch {}
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}
