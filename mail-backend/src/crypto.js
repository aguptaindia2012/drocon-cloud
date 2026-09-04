// AES-256-GCM encryption for mailbox passwords at rest.
// Ciphertext format (base64): iv(12) | authTag(16) | ciphertext
import crypto from "node:crypto";

const KEY = Buffer.from(process.env.MASTER_KEY || "", "hex");
if (KEY.length !== 32) {
  throw new Error("MASTER_KEY must be 64 hex chars (32 bytes). Run: npm run genkey");
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(b64) {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
