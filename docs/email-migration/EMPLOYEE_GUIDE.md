# 📧 Move your email from Zoho to Hostinger — Step‑by‑step

**Please finish this today. Do NOT delete anything from Zoho yourself — we only *copy* mail across. IT will switch things over once everyone confirms.**

You will use a free app called **Thunderbird** to copy all your Zoho mail into your new Hostinger mailbox. Nothing is deleted; your Zoho mail stays put until IT confirms the move.

⏱️ Budget 30–60 minutes (mostly waiting while mail copies). A laptop/desktop is much easier than a phone.

---

## Before you start — get these ready
1. **Your email address** (e.g. `yourname@droconbharat.com`).
2. **Your Zoho password.** If you have 2‑factor / OTP on Zoho, you'll need a **Zoho App Password** (steps below).
3. **Your new Hostinger mailbox password** — IT will give this to you, or confirm it's the same box you already set.

> 🔒 **Never type a password into the messenger, email, or send it to anyone.** Only enter passwords inside Thunderbird's account setup. IT will never ask you for your password in chat.

---

## Step 1 — Turn on IMAP in Zoho (once)
1. Open **Zoho Mail** in your browser → **Settings** (gear icon) → **Mail Accounts**.
2. Click your address → under **IMAP Access**, switch it **ON** → Save.

### If Zoho asks for an "App Password" (only if you use OTP/2‑factor)
1. Go to **accounts.zoho.in** → **Security** → **App Passwords**.
2. Click **Generate New Password**, name it `Thunderbird`, and **copy the password it shows**.
3. Use *that* password in Step 3 instead of your normal Zoho password.

---

## Step 2 — Install Thunderbird
1. Download from **https://www.thunderbird.net** and install it.
2. Open it. When it asks to set up an account, you can close/skip the welcome and use **☰ menu → New → Existing Mail Account**.

---

## Step 3 — Add your **Zoho** account (the source)
1. **☰ menu → New → Existing Mail Account.**
2. Enter your **name**, your **email address**, and your **Zoho password** (or the App Password from Step 1).
3. Click **Configure manually** and set:

   | Field | Incoming (IMAP) |
   |---|---|
   | Protocol | **IMAP** |
   | Server | **imap.zoho.in**  *(if that fails, try `imap.zoho.com`)* |
   | Port | **993** |
   | Security | **SSL/TLS** |
   | Username | your full email address |

   *(You can ignore/skip the outgoing server for Zoho — we're only reading from it.)*
4. Click **Re‑test → Done**. Your Zoho folders (Inbox, Sent, etc.) will appear on the left and start downloading. **Let them finish downloading** before the next step (folder names stop showing "…").

---

## Step 4 — Add your **Hostinger** account (the destination)
1. **☰ menu → New → Existing Mail Account** again.
2. Enter your name, the **same email address**, and your **Hostinger mailbox password**.
3. **Configure manually:**

   | Field | Incoming (IMAP) | Outgoing (SMTP) |
   |---|---|---|
   | Server | **imap.hostinger.com** | **smtp.hostinger.com** |
   | Port | **993** | **465** |
   | Security | **SSL/TLS** | **SSL/TLS** |
   | Username | your full email address | your full email address |

   > If IT tells you your mail is on **Titan**, use `imap.titan.email` and `smtp.titan.email` instead.
4. Click **Done**. You now have **two** accounts in the left column: Zoho and Hostinger.

---

## Step 5 — Copy your mail across (the important bit)
Do this **one folder at a time**, starting with **Inbox**, then **Sent**, then the rest:

1. Click the **Zoho → Inbox** folder. Wait for the message list to load fully.
2. Click any message, then press **Ctrl + A** to select **all** messages in that folder.
3. **Right‑click** the selection → **Copy To → (your Hostinger account) → Inbox**.
4. A progress bar appears at the bottom. **Wait for it to finish** (large folders can take a while — leave it running).
5. Repeat for **Sent**, **Drafts**, **Archive**, and any other folders you care about.
   - For folders that don't exist on Hostinger yet: right‑click your Hostinger account → **New Folder** → give it the same name, then copy into it.

> ✅ Tip: copy the **Inbox** and **Sent** first — those matter most. You can do the rest after.

---

## Step 6 — Check it worked
1. Click each **Hostinger** folder and confirm the message count roughly matches the Zoho one (bottom status bar shows the count).
2. Spot‑check: open a few copied emails on the Hostinger side and confirm attachments are there.

---

## Step 7 — Tell IT you're done
Reply in the **messenger** with:
- ✅ **"Email copied — [your address]"**
- Note any folder that failed or looked short, so IT can help.

**Do not delete your Zoho mailbox or change any settings.** IT will do the final switch‑over (so new mail starts arriving in Hostinger) after everyone confirms.

---

## Common hiccups
- **"Login failed" on Zoho** → you likely need the **App Password** (Step 1), or IMAP isn't switched on yet.
- **"Login failed" on Hostinger** → the mailbox may not be created yet, or the password is different — check with IT.
- **Wrong Zoho server** → if `imap.zoho.in` fails, try `imap.zoho.com` (depends on where the account was created).
- **Copy is very slow / stalls** → do smaller folders, keep the laptop awake and on Wi‑Fi/power; it resumes if you re‑try.
- **Stuck?** Post a screenshot in the messenger and IT will guide you — but **blur/hide any password**.
