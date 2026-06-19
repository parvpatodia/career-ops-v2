#!/bin/bash
# Daily outreach loop (launchd entry point).
# 1. Reconcile the inbox first: replies and bounces suppress future contact.
# 2. Source + draft + gated send (up to the daily cap of 5).
# All output is appended to data/outreach/cron.log so a run is auditable.

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="/Users/parvpatodia/career-ops-v2"
cd "$REPO" || exit 1
mkdir -p "$REPO/data/outreach"
LOG="$REPO/data/outreach/cron.log"

{
  echo ""
  echo "===================== $(date) ====================="
  echo "--- inbox reconcile ---"
  npm run --silent inbox
  echo "--- outreach: plan + gated send ---"
  npm run --silent outreach:daily
  echo "===================== done $(date) ================="
} >> "$LOG" 2>&1
