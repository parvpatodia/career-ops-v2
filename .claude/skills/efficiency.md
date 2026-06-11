---
name: efficiency
description: Research token-saving techniques, review current session budget, and log findings to data/efficiency_log.md.
user_invocable: true
args: command
---

# efficiency — Token Optimization

## Args
- (empty) → session budget report + apply current rules
- `research` → search for new compression/efficiency techniques and log them
- `report` → weekly token usage breakdown from logs

## Session Budget Report

Read `data/daily_log/token-usage.jsonl` for today.

Output:
```
Session Token Budget
────────────────────
scan (all):      4,200 tokens
eval (12 jobs):  9,600 tokens
tailor (3 jobs): 11,400 tokens
─────────────────────────────
Session total:   25,200 / 50,000 tokens (50%)

Cost per application: ~8,400 tokens
```

Warn if total > 40,000.

## Efficiency Rules (always apply)

1. **Cache first**: Check `data/daily_log/[today]-*.json` before any scan
2. **Batch, don't interleave**: scan all → eval all → tailor selected. Never scan+eval+tailor one job at a time.
3. **Skip cover letters below 60**: CL generation costs ~4K tokens. Not worth it for low-fit jobs.
4. **Compress structured data**: Internal pipeline uses JSON, not prose. Never narrate results to yourself.
5. **Skip re-evaluation**: If `data/applications.json` has a score for a job_id, return cached score.
6. **Truncate JDs**: If JD > 2000 words, extract top 500 words (requirements section only) before sending to evaluator.

## Research Mode

When `research` is called:
1. Search GitHub for recent discussions on Claude Code token optimization
2. Search for "prompt compression" techniques published in the last 3 months
3. Check Anthropic docs for any new context caching or batching APIs

Log findings to `data/efficiency_log.md`:
```markdown
## [Date] Efficiency Research

### Finding: [title]
Source: [url or "manual"]
Technique: [1-2 sentence description]
Estimated savings: [tokens/session or %]
Applied: [yes/no]
```

## Weekly Report

Read all `data/daily_log/token-usage.jsonl` entries from the past 7 days.

Output:
```
Weekly Token Report
───────────────────
Scan:     28,400 tokens (22%)
Evaluate: 48,000 tokens (37%)
Tailor:   39,000 tokens (30%)
Apply:    14,400 tokens (11%)
───────────────────────────────
Total:    129,800 tokens
~Cost:    $0.13 (at $1/MTok input pricing)

Most expensive day: Thursday (32,400 tokens)
Highest single operation: batch eval of 24 jobs (19,200 tokens)

Suggestion: Use eval top 15 instead of eval batch to save ~4,800 tokens/day
```
