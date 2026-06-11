#!/usr/bin/env bash
# Weekly codebase + product audit shortcut.
# Run: npm run audit  OR  bash scripts/weekly_audit.sh [code|product|both]

set -euo pipefail

AUDIT_TYPE="${1:-both}"
TODAY=$(date +%Y-%m-%d)

echo "=== Weekly Audit — ${TODAY} ==="
echo ""

if [[ "$AUDIT_TYPE" == "code" || "$AUDIT_TYPE" == "both" ]]; then
  echo "--- Code Quality Check ---"

  echo "TypeScript build:"
  npm run build && echo "✓ No type errors" || echo "✗ Build errors found"

  echo ""
  echo "Tests:"
  npm test && echo "✓ All tests passing" || echo "✗ Test failures found"

  echo ""
  echo "Unused dependencies check:"
  if command -v npx &>/dev/null; then
    npx depcheck --ignores="@types/*,tsx,vitest,@vitest/*" 2>/dev/null || true
  fi
fi

if [[ "$AUDIT_TYPE" == "product" || "$AUDIT_TYPE" == "both" ]]; then
  echo ""
  echo "--- Product Metrics ---"
  npm run stats -- all
fi

echo ""
echo "Full audit analysis: open Claude Code and run '/audit'"
