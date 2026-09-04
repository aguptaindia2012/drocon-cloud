# Admin Runbook — Zoho → Hostinger email migration

Two ways to migrate. Pick per your comfort:

- **Option A — Employee self‑service (Thunderbird).** Send everyone `EMPLOYEE_GUIDE.md` via the messenger. No password sharing, each person copies their own mail. Best for privacy; slowest to coordinate.
- **Option B — Central bulk (imapsync).** *You* copy every mailbox centrally with one script. Fast and uniform, but you must **collect an app password for each account** — handle those securely (see below).

**Golden rule for both:** migration only **copies** mail. Nothing on Zoho is touched. You keep Zoho live (and paid) until every mailbox is verified on Hostinger and MX is cut over.

---

## Server settings (confirm before running)

| | Zoho (source) | Hostinger (destination) |
|---|---|---|
| IMAP host | `imap.zoho.in` *(India)* or `imap.zoho.com` | `imap.hostinger.com` *(or `imap.titan.email` if Titan)* |
| IMAP port | 993 (SSL) | 993 (SSL) |
| SMTP (for later) | — | `smtp.hostinger.com` : 465 (SSL) |

**How to tell which Zoho host:** if you sign in at zoho **.in**, use `imap.zoho.in`. If unsure, the script tries `.in` and you switch to `.com` if it fails.

**How to tell Hostinger vs Titan:** hPanel → **Emails** → your domain → **Configuration / Connect Devices**. It lists the exact IMAP/SMTP host. Use whatever it shows.

---

## Pre‑flight checklist
1. **Create every mailbox on Hostinger first** (hPanel → Emails → Create), same addresses as Zoho. Set (and record) each password.
2. On **Zoho**, ensure **IMAP is enabled** org‑wide (Zoho Admin Console → Mail Settings → IMAP/POP) — or each user enables it (guide Step 1).
3. **App passwords:** if accounts have 2FA, generate a Zoho **App Password** per account (accounts.zoho.in → Security → App Passwords). Hostinger uses the mailbox password directly.
4. Do a **dry run first** (below) — it connects and counts, changes nothing.

---

## Option B — Central bulk with imapsync

`imapsync` is the standard IMAP‑to‑IMAP copy tool. It's **resumable and idempotent** — re‑running only copies what's missing, so it's safe to run repeatedly until counts match.

### Where to run it
- **Windows (your machine):** install **WSL** (Ubuntu) — `wsl --install` in an elevated PowerShell, reboot — then run everything inside Ubuntu. (imapsync's native Windows build is paid; WSL is free.)
- Or any Linux box / Mac.

### Install imapsync (inside Ubuntu/WSL)
```bash
sudo apt update
sudo apt install -y imapsync
imapsync --version   # confirm it runs
```

### Fill in the accounts file
Copy `accounts.example.csv` to `accounts.csv` and add one line per mailbox:
```
email,zoho_password,hostinger_password
ravi@droconbharat.com,ZOHO_APP_PW,HOSTINGER_PW
priya@droconbharat.com,ZOHO_APP_PW,HOSTINGER_PW
```
> 🔒 **This file holds live passwords.** Keep it only on your machine, never commit it, never send it in chat, and **delete it after the migration** (`shred -u accounts.csv`). It is already in `.gitignore`.

### 1) Dry run (safe — copies nothing)
```bash
./migrate-zoho-to-hostinger.sh --dry accounts.csv
```
Read the summary: it should connect to both sides and report message counts. Fix any login errors before the real run.

### 2) Real run
```bash
./migrate-zoho-to-hostinger.sh accounts.csv
```
- Per‑account logs land in `./logs/<email>.log`.
- Re‑run the same command any time — it resumes and only copies what's missing.

### 3) Verify
```bash
./migrate-zoho-to-hostinger.sh --verify accounts.csv
```
Prints Zoho vs Hostinger message counts side by side. They should match (Hostinger may be +/- a couple on system folders — that's normal).

---

## Cut‑over (only after ALL mailboxes verified)
1. Announce a short quiet window (e.g. early morning).
2. Run the migration **once more** to sweep up mail that arrived since the last run.
3. **Change MX records** for the domain to Hostinger's MX (hPanel → Emails → DNS/MX shows the exact values). New mail now flows to Hostinger.
4. Keep **Zoho active for ~1–2 weeks** as a safety net (mail can still trickle to old MX during DNS propagation; run imapsync a final time before cancelling Zoho).
5. Update mail clients / phones to the Hostinger IMAP/SMTP settings (or re‑add the account).

## Rollback / safety
- Nothing is deleted on Zoho, so rollback = point MX back to Zoho. No data loss.
- Keep the **cold backup** (below) regardless of how the live migration goes.

## Cold backup (permanent archive, independent of Hostinger)
Keep an offline copy of each Zoho mailbox as files you control:
```bash
# creates ./backup/<email>/ as a local Maildir copy from Zoho
./migrate-zoho-to-hostinger.sh --backup accounts.csv
```
Zip `./backup/` and store it somewhere safe (external drive / cloud). This is your insurance even after Zoho is cancelled.
