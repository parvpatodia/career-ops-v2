#!/bin/bash
# Auto-tailor loop (M9 F7). Pre-tailors the fresh, on-field, last-24h shortlist so
# a resume + cover letter (dated today, verify-or-abstain) is ready to upload the
# moment a role is opened. Idempotent: `tailor:fresh` skips roles already tailored
# TODAY, so after the first batch each run only tailors genuinely-new last-24h
# roles. ~30-min cadence because PDF generation (Playwright) is heavy and new
# intern postings appear a few times a day, not per-second.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd /Users/parvpatodia/career-ops-v2 || exit 1
echo "======== [$(date '+%Y-%m-%d %H:%M:%S')] tailor:fresh ========"
npm run tailor:fresh
