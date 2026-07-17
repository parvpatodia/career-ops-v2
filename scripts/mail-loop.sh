#!/bin/bash
# Mac-local email ingestion loop (M8). Reads recent Apple Mail messages, extracts
# on-field junior job links (SWE List, LinkedIn alerts, other digests) and merges
# them into the UI hot-list. Runs on a ~30-min cadence (digests are daily; the
# raw-source scan costs ~60s, so this is NOT part of the 60s board watcher).
#
# REQUIRES: Mail.app OPEN, and a one-time macOS Automation grant for this process
# to control Mail (first run may prompt or fail with -1743 until granted).
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd /Users/parvpatodia/career-ops-v2 || exit 1
echo "======== [$(date '+%Y-%m-%d %H:%M:%S')] mail ========"
# 25-message window: digests are daily and the 30-min cadence overlaps windows,
# so 25 newest is plenty and keeps the slow AppleScript scan well under timeout.
npm run inbox:mac -- 25 4
