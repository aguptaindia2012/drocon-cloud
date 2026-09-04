#!/usr/bin/env python3
"""Cold backup of an IMAP mailbox to local .eml files (stdlib only).

Reads connection details from environment (set by migrate-zoho-to-hostinger.sh):
  IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS, OUT_DIR

Writes:  <OUT_DIR>/<folder>/<uid>.eml   — one file per message.
Safe to re-run: messages already saved are skipped.
"""
import email.utils
import imaplib
import os
import re
import sys

HOST = os.environ["IMAP_HOST"]
PORT = int(os.environ.get("IMAP_PORT", "993"))
USER = os.environ["IMAP_USER"]
PASS = os.environ["IMAP_PASS"]
OUT = os.environ.get("OUT_DIR", "backup")

imaplib._MAXLINE = 10_000_000  # some servers send long folder lists


def safe(name: str) -> str:
    return re.sub(r'[^\w.\-]+', "_", name).strip("_") or "folder"


def main() -> int:
    try:
        M = imaplib.IMAP4_SSL(HOST, PORT)
        M.login(USER, PASS)
    except Exception as e:  # noqa: BLE001
        print(f"    ! login failed for {USER}: {e}", file=sys.stderr)
        return 1

    typ, folders = M.list()
    if typ != "OK":
        print("    ! could not list folders", file=sys.stderr)
        return 1

    total = 0
    for raw in folders:
        line = raw.decode(errors="replace") if isinstance(raw, bytes) else str(raw)
        # folder name is the last quoted token (or last token) on the LIST line
        m = re.search(r'"([^"]*)"\s*$', line) or re.search(r'([^ ]+)\s*$', line)
        if not m:
            continue
        folder = m.group(1)
        try:
            typ, data = M.select(f'"{folder}"', readonly=True)
        except Exception:  # noqa: BLE001
            continue
        if typ != "OK":
            continue
        typ, ids = M.search(None, "ALL")
        if typ != "OK" or not ids or not ids[0]:
            continue
        uids = ids[0].split()
        dest = os.path.join(OUT, safe(folder))
        os.makedirs(dest, exist_ok=True)
        saved = 0
        for uid in uids:
            path = os.path.join(dest, uid.decode() + ".eml")
            if os.path.exists(path):
                continue
            typ, msg = M.fetch(uid, "(RFC822)")
            if typ != "OK" or not msg or not msg[0]:
                continue
            body = msg[0][1]
            if not body:
                continue
            with open(path, "wb") as fh:
                fh.write(body)
            saved += 1
        total += saved
        print(f"    {folder}: {saved} new ({len(uids)} total)")
    try:
        M.logout()
    except Exception:  # noqa: BLE001
        pass
    print(f"    saved {total} new message(s) to {OUT}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
