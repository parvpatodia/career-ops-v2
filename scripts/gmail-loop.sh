#!/bin/bash
# Gmail IMAP email-ingestion loop. Fetches the newest ~60 Gmail INBOX messages over
# IMAP, extracts on-field/junior/US job links (parseJobEmails) and merges them into
# the UI hot-list. Replaces the Apple Mail loop, whose AppleScript reader hangs on
# the large local inbox. ~30-min cadence: digests are daily and the IMAP fetch of
# the newest ~60 messages is fast + reliable. Read-only; creds from .env/vault.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd /Users/parvpatodia/career-ops-v2 || exit 1
echo "======== [$(date '+%Y-%m-%d %H:%M:%S')] gmail-inbox ========"
npm run inbox:gmail -- 60 5
