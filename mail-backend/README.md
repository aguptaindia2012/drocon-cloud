# DroCon Mail Backend

Bridges the static DroCon Cloud app to **Hostinger IMAP/SMTP**. The browser can't
speak IMAP, so this small always-on service does, on the user's behalf. Each
signed-in user connects **their own** mailbox once; the password is encrypted
(AES-256-GCM) and stored in Supabase `mail_accounts` — it never returns to the
browser and is never logged.

```
app (browser) ──HTTPS+JWT──▶ this backend ──IMAP/SMTP──▶ Hostinger mail
                                   │
                                   └─ mail_accounts (encrypted creds, Supabase)
```

## API (all require `Authorization: Bearer <supabase access token>`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/mail/connect` | validate + store a user's mailbox creds |
| GET | `/mail/status` | is this user connected? |
| DELETE | `/mail/disconnect` | forget this user's creds |
| GET | `/mail/mailboxes` | list folders |
| GET | `/mail/messages?mailbox=INBOX&limit=30&before=<seq>` | list (newest first, paged) |
| GET | `/mail/message?mailbox=INBOX&uid=<uid>` | full parsed message |
| GET | `/mail/attachment?mailbox=&uid=&index=` | download one attachment |
| POST | `/mail/flags` | mark read/unread |
| POST | `/mail/send` | send (with attachments) |

---

## One-time setup on a Hostinger VPS (Ubuntu 22.04+)

Prereqs: a VPS (Hostinger hPanel → VPS), a subdomain for the API pointed at the
VPS IP — e.g. **`mail-api.droconbharat.com`** (A record).

### 1. Base + Node 20
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs nginx
node -v    # v20.x
```

### 2. Get the code onto the VPS
```bash
sudo mkdir -p /opt/drocon-mail && sudo chown $USER /opt/drocon-mail
cd /opt/drocon-mail
# copy the mail-backend/ folder here (git clone the repo, or scp it), then:
npm install --omit=dev
```

### 3. Configure secrets
```bash
cp .env.example .env
npm run genkey          # prints a MASTER_KEY — paste it into .env
nano .env               # fill SUPABASE_URL, SERVICE_ROLE_KEY, JWT_SECRET, ORIGINS
```
- **SUPABASE_SERVICE_ROLE_KEY** and **SUPABASE_JWT_SECRET**: Supabase → Settings → API.
- **ALLOWED_ORIGINS**: your app origin, e.g. `https://aguptaindia2012.github.io`.
- **MASTER_KEY**: keep it forever — if it changes, stored passwords can't be decrypted and everyone reconnects.

### 4. Run it as a service (systemd)
```bash
sudo tee /etc/systemd/system/drocon-mail.service >/dev/null <<'UNIT'
[Unit]
Description=DroCon Mail Backend
After=network.target
[Service]
WorkingDirectory=/opt/drocon-mail
ExecStart=/usr/bin/node src/server.js
EnvironmentFile=/opt/drocon-mail/.env
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
UNIT
sudo chown -R www-data:www-data /opt/drocon-mail
sudo systemctl daemon-reload && sudo systemctl enable --now drocon-mail
systemctl status drocon-mail --no-pager
curl -s localhost:8091/health     # {"ok":true}
```

### 5. HTTPS via nginx + Let's Encrypt
```bash
sudo tee /etc/nginx/sites-available/drocon-mail >/dev/null <<'NGINX'
server {
  server_name mail-api.droconbharat.com;
  client_max_body_size 30m;
  location / {
    proxy_pass http://127.0.0.1:8091;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
  }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/drocon-mail /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d mail-api.droconbharat.com
```
Now `https://mail-api.droconbharat.com/health` should return `{"ok":true}`.

### 6. Point the app at it
In the app's `config.js`, add:
```js
window.DCB_CONFIG.MAIL_API = "https://mail-api.droconbharat.com";
```
(The in-app Mail screen — Phase 2b — reads this.)

---

## Updating later
```bash
cd /opt/drocon-mail && git pull   # or re-copy files
npm install --omit=dev
sudo systemctl restart drocon-mail
```

## Security notes
- The service listens only on `127.0.0.1`; nginx terminates TLS and proxies to it.
- Mailbox passwords: encrypted at rest, decrypted only in memory to connect, never sent to the browser, never written to logs.
- Only requests carrying a valid Supabase login token are served, each scoped to that user's own mailbox.
- Keep `.env` readable only by `www-data`/root (`chmod 600 .env`).
