# M8 — Newest-role firehose + local command-center UI

> Spec date 2026-07-16. MODE: BUILD. Goal: surface the newest Fall-2026 intern/co-op
> roles within minutes of posting, in a local UI, with a desktop notification, and
> fill applications in the background without stealing screen focus.

## Why
Applications are first-come-first-served; speed is the edge. Parv keeps a UI open in
one Chrome window; a new on-field role must appear there and fire a laptop notification
within ~1 minute of being published, so he can open and finish it fast, then get back
to work — without a browser window jumping to the front mid-task.

## Sources (Parv approved all three, 2026-07-16)
1. **ATS board APIs (backbone, reliable)** — Greenhouse / Lever / Ashby public APIs.
   Expand the token lists from ~50 to as many *live-verified* AI/ML/robotics/AV/SWE
   companies as we can confirm return 200 + jobs. No auth, no browser, no ban risk.
2. **Outlook job-alert emails (reliable, needs login)** — the daily aggregator emails
   (Scalar + the other intern sender). They already scraped LinkedIn/Indeed/Handshake,
   so parsing them is the safe way to get those postings. Needs a Microsoft re-login.
3. **LinkedIn / Indeed / Handshake / Wellfound scrapers (fragile, best-effort)** —
   direct/Apify scraping. Rate-limited, bot-detected, needs logged-in cookies, breaks
   often, can flag real accounts. Gated behind explicit env flags; never on the hot
   path; honestly labelled fragile. Skeletons already exist under src/scanner/.

## Hard constraints (unchanged invariants)
- Freshness ≤14d, no exceptions (inv 9). Unparseable date = not fresh.
- F-1 eligibility: never surface clearance/ITAR/US-person roles (INELIGIBLE_KEYWORDS).
- On-field only: AI/ML/SWE/robotics/AV/CV/data (isRelevantRole). The role matters, not
  the company.
- US-based only.
- Watch NEVER submits. Fill is background; captcha + submit stay the human touchpoint.
- No board API abuse: every-minute cadence must be list-first (one request/board/cycle),
  detail fetched ONLY for genuinely-new ids, with a concurrency cap + per-request timeout.

## Features (each gated by a runnable check)
- **F1 Board expansion** — add live-verified tokens to config/{greenhouse,lever,ashby}-boards.yml.
  Gate: a verify script curls every token and reports live count; no dead tokens added.
- **F2 Single source of truth** — hunt-fresh.mjs reads the config yml, not a hardcoded list.
  Gate: hunt-fresh runs off config.
- **F3 Fast parallel watcher @60s** — src/watch: parallel list-first scan, seen-diff,
  detail-on-new, category tag on each hot-list entry. watch-loop plist → 60s.
  Gate: watch run shows N boards scanned within budget; plist interval = 60.
- **F4 UI command center** — group fresh roles by day → by category; add an Applied
  section; 15s auto-refresh; keep the Apply/Open launcher.
  Gate: server up, /api/feed returns grouped shape, DOM inspected.
- **F5 Outlook ingestion** — login, read Scalar + the other sender, parse job links into
  the hot-list (category-tagged). Gate: emails read, parsed roles appear in the feed.
- **F6 Background fill, no focus-steal** — fill stays headless; the headed takeover
  window launches WITHOUT stealing focus (reactivate prior frontmost app), then notifies.
  Gate: reactivation helper unit-tested; fill path stays headless until the touchpoint.

## Non-goals
- No hosted server, no auth, no data leaving the machine (each person runs their own clone).
- No auto-submit. No captcha-solving. No fabricated answers.
