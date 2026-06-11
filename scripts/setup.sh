#!/usr/bin/env bash
# One-command setup for career-ops.
# Run: bash scripts/setup.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[setup]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
fail() { echo -e "${RED}[fail]${NC} $1"; exit 1; }

log "career-ops setup starting..."

# Check Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install from https://nodejs.org (v20+)"
fi
NODE_VER=$(node --version | cut -c2- | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  fail "Node.js v20+ required. Found: $(node --version)"
fi
log "Node.js $(node --version) ✓"

# Install npm dependencies
log "Installing npm dependencies..."
npm install

# Install Playwright browsers
log "Installing Playwright Chromium..."
npx playwright install chromium

# Create required directories
for dir in output/resumes output/cover_letters data/daily_log data/reports; do
  mkdir -p "$dir"
  log "Created $dir"
done

# Copy config templates if missing
if [ ! -f "config/profile.yml" ]; then
  cp config/profile.example.yml config/profile.yml
  warn "config/profile.yml created from template. Edit it with your details."
fi

# Create .env if missing
if [ ! -f ".env" ]; then
  cat > .env << 'EOF'
# Apify token for LinkedIn/Wellfound/Google Jobs scraping
# Get one at https://apify.com (free tier sufficient)
APIFY_TOKEN=

# Optional: LinkedIn credentials for Playwright-based scraping
LINKEDIN_EMAIL=
LINKEDIN_PASSWORD=
EOF
  warn ".env created. Add your APIFY_TOKEN to enable platform scanning."
fi

# Create data files if missing
if [ ! -f "data/applications.json" ]; then
  echo "[]" > data/applications.json
  log "Created data/applications.json"
fi

if [ ! -f "data/applications.md" ]; then
  cat > data/applications.md << 'EOF'
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
EOF
  log "Created data/applications.md"
fi

# Run TypeScript check
log "Running TypeScript build check..."
if npm run build 2>&1 | grep -q "error TS"; then
  fail "TypeScript errors found. Run 'npm run build' to see them."
fi
log "TypeScript ✓"

# Run tests
log "Running tests..."
if npm test 2>&1 | grep -q "failed"; then
  warn "Some tests failed. Run 'npm test' to see details."
else
  log "Tests ✓"
fi

echo ""
log "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit config/profile.yml with your name, email, target roles, and skills"
echo "  2. Add your resume to cv/master.md (and cv/ai.md, cv/ml.md, etc.)"
echo "  3. Add APIFY_TOKEN to .env for platform scanning"
echo "  4. Run: npm run scan to discover your first jobs"
echo "  5. Or open Claude Code and type: /career-ops"
