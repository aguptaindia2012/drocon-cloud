#!/usr/bin/env bash
# ============================================================================
# Zoho -> Hostinger mailbox migration (bulk, resumable) using imapsync.
# Usage:
#   ./migrate-zoho-to-hostinger.sh [--dry|--verify|--backup] accounts.csv
#
#   (no flag)  copy all mail Zoho -> Hostinger  (safe to re-run; resumes)
#   --dry      connect + report only; copies NOTHING
#   --verify   print Zoho vs Hostinger folder message counts side by side
#   --backup   download each Zoho mailbox to ./backup/<email>/ as .eml files
#
# accounts.csv format (header required):
#   email,zoho_password,hostinger_password
#
# Override servers if needed:
#   ZOHO_HOST=imap.zoho.com HOSTINGER_HOST=imap.titan.email ./migrate-...sh accounts.csv
# ============================================================================
set -u

ZOHO_HOST="${ZOHO_HOST:-imap.zoho.in}"          # India DC; use imap.zoho.com for global
HOSTINGER_HOST="${HOSTINGER_HOST:-imap.hostinger.com}"  # or imap.titan.email for Titan
PORT1="${PORT1:-993}"
PORT2="${PORT2:-993}"

MODE="run"
case "${1:-}" in
  --dry)    MODE="dry";    shift ;;
  --verify) MODE="verify"; shift ;;
  --backup) MODE="backup"; shift ;;
  --*)      echo "Unknown option: $1"; exit 1 ;;
esac

CSV="${1:-accounts.csv}"
if [[ ! -f "$CSV" ]]; then echo "Accounts file not found: $CSV"; exit 1; fi

if [[ "$MODE" != "backup" ]] && ! command -v imapsync >/dev/null 2>&1; then
  echo "imapsync is not installed. On Ubuntu/WSL:  sudo apt install -y imapsync"; exit 1
fi
mkdir -p logs

# --- read CSV (skip header, ignore blank lines / comments) ---
read_accounts() {
  tail -n +2 "$CSV" | sed 's/\r$//' | while IFS=',' read -r email zpw hpw; do
    [[ -z "${email// }" || "${email:0:1}" == "#" ]] && continue
    printf '%s\t%s\t%s\n' "$email" "$zpw" "$hpw"
  done
}

sync_one() {
  local email="$1" zpw="$2" hpw="$3" extra="$4"
  echo "==================================================================="
  echo ">>> $email   ($MODE)"
  imapsync \
    --host1 "$ZOHO_HOST"      --user1 "$email" --password1 "$zpw" --ssl1 --port1 "$PORT1" \
    --host2 "$HOSTINGER_HOST" --user2 "$email" --password2 "$hpw" --ssl2 --port2 "$PORT2" \
    --automap --skipcrossduplicates --nofoldersizes \
    --logfile "logs/${email}.log" $extra
  echo "    log: logs/${email}.log"
}

case "$MODE" in
  dry)
    read_accounts | while IFS=$'\t' read -r email zpw hpw; do
      sync_one "$email" "$zpw" "$hpw" "--dry"
    done ;;
  run)
    read_accounts | while IFS=$'\t' read -r email zpw hpw; do
      sync_one "$email" "$zpw" "$hpw" ""
    done
    echo; echo "Done. Re-run any time to sweep up new mail (it resumes)." ;;
  verify)
    read_accounts | while IFS=$'\t' read -r email zpw hpw; do
      echo "==================================================================="
      echo ">>> $email  — folder counts (Zoho vs Hostinger)"
      imapsync \
        --host1 "$ZOHO_HOST"      --user1 "$email" --password1 "$zpw" --ssl1 --port1 "$PORT1" \
        --host2 "$HOSTINGER_HOST" --user2 "$email" --password2 "$hpw" --ssl2 --port2 "$PORT2" \
        --justfoldersizes --dry 2>/dev/null | grep -Ei 'Host[12].*folder|messages? +in|Total'
    done ;;
  backup)
    command -v python3 >/dev/null 2>&1 || { echo "python3 required for --backup"; exit 1; }
    read_accounts | while IFS=$'\t' read -r email zpw hpw; do
      echo ">>> Backing up $email  ->  ./backup/$email/"
      IMAP_HOST="$ZOHO_HOST" IMAP_PORT="$PORT1" IMAP_USER="$email" IMAP_PASS="$zpw" \
      OUT_DIR="backup/$email" python3 "$(dirname "$0")/imap_backup.py"
    done ;;
esac
