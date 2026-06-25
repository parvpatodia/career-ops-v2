#!/bin/bash
# 24/7 sourcing loop for career-ops-v2 (set up 2026-06-23).
#
# scan fresh jobs -> tailor the TOP-scoring fresh ones into the Ready queue
# (M6 verify-or-abstain) -> expire aged-out Ready entries. Runs LOCALLY via a
# launchd LaunchAgent because it needs the gitignored config/, cv/, and repo
# state that a cloud routine cannot see.
#
# SAFETY: this loop sources + tailors ONLY. It NEVER submits anything to an
# employer. The captcha submit step stays a human touchpoint: run
#   npm run run -- --auto
# yourself to actually apply (you solve the captcha when the Chrome window pops).
#
# --top 10: tailor only the 10 highest-scoring FRESH jobs per cycle, so the loop
# does not flood the queue or burn M6 PDF renders on the long tail of scraper
# stub-JD postings. Adjust the number to taste.

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
cd /Users/parvpatodia/career-ops-v2 || exit 1

TS="$(date '+%Y-%m-%d %H:%M:%S')"
echo "================ [$TS] sourcing loop start ================"

echo "--- scan ---";   npm run scan;                echo "scan exit=$?"
echo "--- source ---"; npm run source -- --top 10;  echo "source exit=$?"
echo "--- expire ---"; npm run expire;              echo "expire exit=$?"

echo "--- queue after ---"; npm run run -- --stats
echo "================ [$TS] sourcing loop done ================"
