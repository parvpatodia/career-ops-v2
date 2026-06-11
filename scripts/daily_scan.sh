#!/usr/bin/env bash
# Daily job discovery shortcut.
# Run: npm run daily  OR  bash scripts/daily_scan.sh [platform]

set -euo pipefail

PLATFORM="${1:-all}"
TODAY=$(date +%Y-%m-%d)
LOG_FILE="data/daily_log/${TODAY}-scan.log"

mkdir -p data/daily_log

echo "[${TODAY}] Starting daily scan (platform: ${PLATFORM})" | tee -a "$LOG_FILE"

# Run scanner
npm run scan -- --platform "$PLATFORM" 2>&1 | tee -a "$LOG_FILE"

echo "[${TODAY}] Scan complete. Results cached in data/daily_log/" | tee -a "$LOG_FILE"
echo ""
echo "Next: open Claude Code and run 'eval batch' to score today's discoveries."
