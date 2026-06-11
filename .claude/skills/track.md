---
name: track
description: View application status, update pipeline state, and show conversion stats.
user_invocable: true
args: command
---

# track — Application CRM

## Args
- (empty) → show pipeline summary
- `[id] [status]` → update application status
- `stats [today|week|month|all]` → conversion metrics
- `pending` → list applications awaiting your decision

## Pipeline Summary (default)
```
npm run track -- summary
```

Output:
```
Pipeline: 42 total

  Evaluated:  8   (ready to apply)
  Applied:    21
  Responded:  5
  Interview:  3
  Offer:      1
  Rejected:   7
  Discarded:  4
  SKIP:       2
```

## Update Status
```
npm run track -- 001 Applied
npm run track -- 003 Interview "Phone screen scheduled for May 5"
npm run track -- 007 Rejected
```

Valid statuses: `Evaluated | Applied | Responded | Interview | Offer | Rejected | Discarded | SKIP`

## Stats View
```
npm run stats -- week
```

Output:
```
=== Stats (week) ===
Total applications: 12
Average score: 71/100

By status:
  Applied: 8
  Responded: 2
  Interview: 1
  Rejected: 1

Conversion rates:
  Applied → Response: 25.0%
  Response → Interview: 50.0%
  Interview → Offer: 0.0%

Top companies:
  Waymo: 2
  Scale AI: 2
  Cohere: 1
```

## Pending Applications
```
npm run track -- pending
```

Lists all `Evaluated` applications not yet acted on. Helps start the day's apply session.

## Data Files
- `data/applications.json` — structured data, source of truth
- `data/applications.md` — markdown table, rebuilt on every write
- Both are always in sync (dual-write on every update)
