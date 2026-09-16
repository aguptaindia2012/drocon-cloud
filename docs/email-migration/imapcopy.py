#!/usr/bin/env python3
"""Copy recent messages between two IMAP mailboxes (e.g. Hostinger -> Zoho).

Dependency-free (python3 stdlib). Reads config from environment so passwords
never appear on the command line / shell history:

  SRC_HOST, SRC_USER, SRC_PASS      source (e.g. imap.hostinger.com)
  DST_HOST, DST_USER, DST_PASS      destination (e.g. imappro.zoho.in)
  DAYS      how many days back to copy (default 3)
  FOLDER    mailbox to copy (default INBOX)
  DRY       "1" = just count/preview, copy nothing (default 0)

Preserves each message's flags (read/unread) and original date. Uploading the
same message twice creates a duplicate, so run the real copy once.
"""
import email.utils
import imaplib
import os
import sys
import time

imaplib._MAXLINE = 10_000_000

SRC = (os.environ["SRC_HOST"], os.environ["SRC_USER"], os.environ["SRC_PASS"])
DST = (os.environ["DST_HOST"], os.environ["DST_USER"], os.environ["DST_PASS"])
DAYS = int(os.environ.get("DAYS", "3"))
FOLDER = os.environ.get("FOLDER", "INBOX")
DRY = os.environ.get("DRY", "0") == "1"
# Optional explicit IMAP-date window (DD-Mon-YYYY, e.g. 07-Sep-2026). SINCE is
# inclusive; BEFORE is EXCLUSIVE (BEFORE 15-Sep-2026 => up to and incl. 14th).
SINCE_DATE = os.environ.get("SINCE", "").strip()
BEFORE_DATE = os.environ.get("BEFORE", "").strip()


def main() -> int:
    since = SINCE_DATE or time.strftime("%d-%b-%Y", time.gmtime(time.time() - DAYS * 86400))
    crit = f"(SINCE {since}" + (f" BEFORE {BEFORE_DATE}" if BEFORE_DATE else "") + ")"
    span = f"SINCE {since}" + (f" BEFORE {BEFORE_DATE}" if BEFORE_DATE else f" ({DAYS}d)")
    print(f"Copying '{FOLDER}' messages {span}  ({SRC[1]} -> {DST[1]})  DRY={DRY}")

    try:
        src = imaplib.IMAP4_SSL(SRC[0], 993); src.login(SRC[1], SRC[2])
    except Exception as e:  # noqa: BLE001
        print(f"! source login failed: {e}", file=sys.stderr); return 1
    try:
        dst = imaplib.IMAP4_SSL(DST[0], 993); dst.login(DST[1], DST[2])
    except Exception as e:  # noqa: BLE001
        print(f"! destination login failed: {e}", file=sys.stderr); return 1

    typ, _ = src.select(f'"{FOLDER}"', readonly=True)
    if typ != "OK":
        print(f"! cannot open source folder {FOLDER}", file=sys.stderr); return 1
    dst.select(f'"{FOLDER}"')  # ensure it exists on dest (INBOX always does)

    typ, data = src.search(None, crit)
    ids = data[0].split() if (typ == "OK" and data and data[0]) else []
    print(f"found {len(ids)} message(s) matching {crit}")

    copied = 0
    for i in ids:
        typ, md = src.fetch(i, "(FLAGS INTERNALDATE RFC822)")
        if typ != "OK" or not md or not isinstance(md[0], tuple):
            continue
        info, raw = md[0][0], md[0][1]
        if not raw:
            continue
        try:
            flags = b" ".join(f for f in imaplib.ParseFlags(info) if b"\\Recent" not in f)
            flagstr = "(" + flags.decode() + ")" if flags else None
            idate = imaplib.Internaldate2tuple(info)
        except Exception:  # noqa: BLE001
            flagstr, idate = None, None
        if DRY:
            try:
                subj = email.message_from_bytes(raw).get("Subject", "")
            except Exception:  # noqa: BLE001
                subj = ""
            print(f"  would copy: {subj[:70]}")
            continue
        r = dst.append(f'"{FOLDER}"', flagstr, idate, raw)
        if r and r[0] == "OK":
            copied += 1

    print(f"{'(dry run) ' if DRY else ''}done — {'would copy '+str(len(ids)) if DRY else 'copied '+str(copied)} message(s).")
    try: src.logout(); dst.logout()
    except Exception: pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
