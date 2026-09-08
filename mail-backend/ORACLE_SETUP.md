# Deploying the mail backend on Oracle Cloud (Always Free)

Same backend as `README.md` — only the "where it runs" differs. Oracle's Always
Free tier gives a real, always-on VPS at no cost. Extra steps vs a normal VPS:
you log in with an **SSH key** (not a password), and you must open ports **80/443**
in **two** places (Oracle's virtual firewall *and* the machine's own firewall).

---

## 1. Sign up
- Go to **oracle.com/cloud/free** → Start for free.
- Email + phone + a **credit card for verification** (not charged on Always Free).
- **Home Region — choose carefully, it's permanent:** pick **India West (Mumbai)**
  or **India South (Hyderabad)** for lowest latency. Always-Free resources live in
  this region.

## 2. Create the VM
Console → ☰ → **Compute → Instances → Create instance**.
- **Name:** `drocon-mail`
- **Image:** Edit → **Canonical Ubuntu 24.04** (or 22.04).
- **Shape:** Edit → **Ampere (Arm)** → `VM.Standard.A1.Flex`, set **1 OCPU / 6 GB**
  (Always-Free covers up to 4 OCPU / 24 GB of A1 total).
  - If you get **"Out of host capacity"**, either retry in a bit, or switch the
    shape to **VM.Standard.E2.1.Micro** (AMD, Always Free) — enough for this.
- **Networking:** keep the default VCN/subnet; ensure **"Assign a public IPv4 address" = Yes**.
- **SSH keys:** choose **Generate a key pair for me → Save private key** (and public key).
  Keep the downloaded **private key** file safe — it's how you log in.
- **Create**. Wait until state = **Running**, then copy the **Public IP address**.

## 3. Open ports 80 + 443 (Oracle virtual firewall)
Instance page → **Virtual Cloud Network** link → **Security Lists** → the default list
→ **Add Ingress Rules**, add two:
| Source CIDR | IP Protocol | Destination Port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

## 4. Log in (from your Windows PC, PowerShell)
```powershell
# move the key somewhere safe and lock its permissions once
icacls "C:\path\to\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i "C:\path\to\ssh-key.key" ubuntu@YOUR_PUBLIC_IP
```
(The login user is **ubuntu**, not root. Say `yes` to the fingerprint prompt.)

## 5. Open ports 80 + 443 (the machine's own firewall)
Oracle's Ubuntu image blocks everything except SSH by default — open the web ports too:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 6. Install + deploy the backend
Same as `README.md`, but prefix admin commands with `sudo` (you're the `ubuntu`
user, not root). In short:
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs nginx
sudo mkdir -p /opt/drocon-mail && sudo chown $USER /opt/drocon-mail
cd /opt/drocon-mail
# copy the mail-backend/ folder here (git clone the repo, or scp), then:
npm install --omit=dev
cp .env.example .env && npm run genkey    # paste the key into .env
nano .env                                  # fill Supabase + ALLOWED_ORIGINS
```
Then the **systemd service**, **nginx**, and **certbot** steps from `README.md`
sections 4–5 (all with `sudo`). Point **mail-api.droconbharat.com** at the VPS
public IP (DNS A record) before running certbot.

## 7. Verify
`https://mail-api.droconbharat.com/health` → `{"ok":true}`, then add
`window.DCB_CONFIG.MAIL_API = "https://mail-api.droconbharat.com";` to `config.js`.

### Notes
- **Never delete/lose** the SSH private key or the `.env` `MASTER_KEY`.
- Always-Free instances can be reclaimed only if idle for a long time on some tiers;
  the A1/E2 compute used here is not reclaimed while running normally.
