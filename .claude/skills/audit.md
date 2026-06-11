---
name: audit
description: Run a code quality audit (Paul Graham / Elon Musk lens) or product effectiveness audit (Naval / Demis Hassabis lens).
user_invocable: true
args: type
---

# audit — Codebase & Product Audit

## Args
- `code` → code quality audit
- `product` → product effectiveness audit
- (empty) → run both

## Code Audit (Paul Graham / Elon Musk lens)

Questions to answer for every file in `src/`:

1. Is every file necessary? Could two classes be merged without loss of clarity?
2. Is the architecture the simplest possible design that solves the problem?
3. Could a new developer understand this in 30 minutes?
4. Are there premature abstractions or over-engineering?
5. Is test coverage meaningful? (not just line coverage — do tests catch real bugs?)
6. Would you be embarrassed showing this in a YC technical interview?

**Execute:**
- Read all files in `src/` (not just index files)
- Run `npm run build` — zero TypeScript errors required
- Run `npm test` — all tests must pass
- Check for dead code, unused imports, copy-paste duplication

## Product Audit (Naval Ravikant / Demis Hassabis lens)

Questions to answer from `data/applications.json` + `data/daily_log/`:

1. Is this tool actually saving time vs. manual applications? (estimate hours/week saved)
2. What's the apply-to-interview conversion rate? Is it improving week over week?
3. Which platform produces the best-fit jobs? Which should be dropped?
4. Is resume tailoring improving interview rates vs. generic submissions?
5. What's the token cost per successful application?
6. Is there a simpler way to achieve the same outcome?

## Output Format

```markdown
## Audit Report — [Date]

### KEEP (working well)
- Scanner cache: saving ~15 API calls/day
- Evaluator accuracy: 3 of 4 "SKIP" recommendations were correct rejections
- PDF template: no layout complaints

### KILL (remove or stop doing)
- HandshakeScanner: 0 results in 2 weeks, remove from "all" scan
- Cover letters for <65 score: zero responses, set threshold to 65

### FIX (needs improvement)
- Visa detection: false negatives on "US work authorization required" phrasing
- Score calibration: Waymo scores 45 but Parv would clearly apply there

### BUILD (missing, should add)
- Interview prep: no skill for generating STAR story from job evaluation
- Response tracking: no webhook/email parsing for automated status updates
```

## After Audit
- Fix all KILL items immediately
- Create GitHub issues or notes for FIX and BUILD items
- Re-run `npm test` to verify nothing broke during cleanup
