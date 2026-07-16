#!/bin/bash
# Long-running local command-center UI (npm run ui) for launchd KeepAlive, so
# http://localhost:4600 is always up in a Chrome window. Watch + notifications
# run separately (com.parv.careerops.watch). This process only SERVES the read
# model; it never applies or submits.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd /Users/parvpatodia/career-ops-v2 || exit 1
exec npm run ui
