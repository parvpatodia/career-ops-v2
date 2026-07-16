#!/bin/bash
# Fast "be first to apply" watcher loop (set up 2026-07-11). Runs the new-posting
# watcher on a fast launchd cadence so a fresh posting alerts within minutes.
#
# SAFETY: watch + notify ONLY — never applies or submits (applying stays the
# human/captcha step, `npm run run -- --auto`). Runs every 60s (M8): the sweep is
# list-first + concurrency-capped (8 boards at a time) and finishes in ~9s across
# 100+ boards, so it is polite to the public APIs while catching a posting within
# a minute. After expanding config/*-boards.yml, run once with WATCH_SEED=1 to
# absorb the backlog silently before the 60s loop starts alerting.

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd /Users/parvpatodia/career-ops-v2 || exit 1

echo "======== [$(date '+%Y-%m-%d %H:%M:%S')] watch ========"
npm run watch
