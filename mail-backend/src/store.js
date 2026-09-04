// Credential store — reads/writes public.mail_accounts using the Supabase
// service_role key (bypasses RLS; this table is never exposed to the browser).
import { createClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "./crypto.js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function getAccount(userId) {
  const { data, error } = await sb.from("mail_accounts").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// Returns the account with the password decrypted (backend memory only).
export async function getAccountWithPassword(userId) {
  const a = await getAccount(userId);
  if (!a) return null;
  return { ...a, password: decrypt(a.enc) };
}

export async function saveAccount(userId, { email, imap_host, imap_port, smtp_host, smtp_port, password }) {
  const row = {
    user_id: userId, email, imap_host, imap_port, smtp_host, smtp_port,
    enc: encrypt(password), status: "connected", last_error: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("mail_accounts").upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export async function setError(userId, msg) {
  await sb.from("mail_accounts").update({ status: "error", last_error: String(msg).slice(0, 300) }).eq("user_id", userId);
}

export async function deleteAccount(userId) {
  const { error } = await sb.from("mail_accounts").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}
