#!/bin/bash
# Fast "be first to apply" watcher loop (set up 2026-07-11). Runs the new-posting
# watcher on a fast launchd cadence so a fresh posting alerts within minutes.
#
# SAFETY: watch + notify ONLY — never applies or submits (applying stays the
# human/captcha step, `npm run run -- --auto`). A ~5-min cadence is fast enough
# to be among the first applicants WITHOUT hammering the public board APIs into a
# rate-limit/ban that would break sourcing. Do not drop this below a couple
# minutes.

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd /Users/parvpatodia/career-ops-v2 || exit 1

echo "======== [$(date '+%Y-%m-%d %H:%M:%S')] watch ========"
npm run watch
