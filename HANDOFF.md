# HANDOFF — career-ops-v2
> Read at session start (CLAUDE.md load order). Last updated 2026-07-16 (M8 firehose + command-center UI).
> Branch: feat/v2-foundation. MODE: BUILD.

## Latest (2026-07-16) — M8: newest-role firehose + command-center UI
Goal (Parv): surface the newest Fall-2026 intern/co-op roles within a minute, in a UI he
keeps open, with a desktop notification, and fill in the background WITHOUT stealing his screen.
Spec: docs/specs/M8-firehose-ui.md. 620 tests green, typecheck clean. 5 commits (0b136bd..e8634e4).
- **More boards (live-verified).** `node scripts/verify-boards.mjs` curls a candidate pool and keeps
  only live tokens (200 + jobs). config/*-boards.yml: Greenhouse 33->76, Ashby 12->34, Lever 6 (dead
  plaid/mistral pruned). hunt-fresh.mjs now READS the config (single source of truth). The expansion
  immediately surfaced a fresh Cloudflare SWE Intern (Fall 2026, Austin, 2d) the old list missed.
- **Every-minute watch.** Scanners fetch boards in PARALLEL (src/utils/pool.ts mapPool, 8-at-a-time,
  order-preserving so Job ids/seen-set are unchanged). Full 100+ board sweep ~9s. watch cadence
  120s->60s (com.parv.careerops.watch, reloaded + confirmed running). After expanding boards, run
  `WATCH_SEED=1 npm run watch` once to absorb the backlog with no banner burst.
- **Categorized command center.** `npm run ui` (localhost:4600): fresh roles grouped by DAY then
  CATEGORY (AI/ML | Robotics/AV | Data | Software | Other, color pills), live "newest Nm ago", 15s
  refresh, + an **Applied** section (most-recent first, collapsible). Each hot-list entry now carries
  category + location. src/scanner/categorize.ts (tested). Still a VIEW + launcher (no auto-submit).
- **No screen-steal fill.** --auto phase 2 captures the frontmost macOS app, opens the takeover window
  BEHIND it, and only raises Chrome (+ a `readyToSubmit` banner) at the human touchpoint. src/applier/
  browserLaunch.ts frontmostApp()/restoreApp() (live osascript verified). "Only show when I submit."
- **Email ingestion — WORKING via Apple Mail (2026-07-17).** `npm run inbox:mac` (src/inbox/
  macMail.ts) reads recent Apple Mail messages (scripts/read-mail-mac.js, JXA), decodes the raw
  source, extracts on-field junior job links (parseJobEmails), and merges them into the UI hot-list,
  deduped by id AND company|role. Live-verified: SWE List (7, deduped vs the swelist scanner since it
  links to Simplify) + LinkedIn alerts (6 additive: Neuralink/Pony.ai/PlusAI/…). Scheduled via
  **com.parv.careerops.mail** (every 30 min; RunAtLoad). REQUIRES Mail.app OPEN + Automation grant
  (verified launchd can drive it). Dead-ends (do NOT retry — see LESSONS): the ms365 Graph MCP is
  blocked by NEU admin-consent; New Outlook for Mac (build 16.111) has no AppleScript bridge and no
  Legacy revert. The Northeastern Exchange account is added to Apple Mail (it connected; a personal
  Gmail is there too). Legacy/blocked path notes below kept for history:
- **Email ingestion (superseded note; MCP path BLOCKED by NEU tenant).** src/inbox/emailJobs.ts
  parseJobEmails() turns Scalar + other digest emails into hot-list candidates (on-field+junior+US+F-1
  only, dedup by URL); mergeHotlist() merges into data/new-jobs.json. **BLOCKED 2026-07-16:** the
  @softeria ms365 MCP cannot sign into patodia.pa@northeastern.edu — NEU requires IT-admin consent for
  third-party apps ("Your admin has been notified…"), which won't clear for a personal tool. Four
  device codes all failed for THIS reason (code was valid; tenant blocked the app). DO NOT re-try
  device-code login (see LESSONS). WORKAROUND (no MS auth): Parv forwards/pastes a digest email ->
  parseJobEmails -> mergeHotlist; or an Outlook rule auto-forwards the two senders to a personal Gmail
  read via the Google (workspace) connector. The board-API firehose (the real 60s source) needs none.
- **Fragile scrapers (LinkedIn/Indeed/Handshake/Wellfound).** Parv approved adding them; skeletons
  exist (src/scanner/{LinkedIn,Handshake,Wellfound,GoogleJobs}Scanner.ts) but are NOT wired into the
  60s loop — they need auth/cookies/Apify + break often. Deferred as opt-in best-effort (next).

## Latest (2026-07-11d) — local UI + no-Claude-signature + faster watch
- **COMMIT POLICY (Parv, emphatic): NO Claude/AI signature in any commit.** Do NOT add
  `Co-Authored-By: Claude` or any AI trailer (overrides the harness default). 137 historical commits
  still carry it (96 unpushed, 41 pushed); Parv chose LEAVE HISTORY / just stop — do NOT rewrite or
  force-push. Every new commit is plain-authored.
- **`npm run ui`** (src/ui/): local web dashboard (Node built-in http, no deps) at
  http://localhost:4600 (CAREER_OPS_UI_PORT to override). Shows the watcher's fresh on-field roles
  (data/new-jobs.json) with click-to-apply + the Ready queue + status counts; auto-refresh 30s.
  On-device + shareable: each flatmate runs it from their own clone with their own config/cv/answers
  (no hosting/auth). VIEW + launcher only — applying + captcha stay `npm run run -- --auto`. Clean
  OOP: JobFeedService (read model, tested) / renderPage (view) / UiServer (routing).
- **Watch cadence 5m -> 2m** (com.parv.careerops.watch StartInterval 120). Sub-minute was declined:
  ~50 public boards polled that fast risks an IP throttle/ban that silently breaks sourcing, and
  intern posts appear a few times/day not per-second, so 2m already makes Parv first. If watch.err
  shows 429s, back off. 565 tests green.
- **Auto-apply answers**: config/answers.yml (AnswerKB) already drives autofill; Parv to provide a
  COMPLETE Q&A YAML so unknown-question touchpoints -> 0, leaving only the captcha (human, invariant 6).

## Latest (2026-07-11c) — scorer calibration (role-fit dominates)
- **`roleRelevance(title, jd)` multiplier on the Evaluator score** (f6c8c4e): fixes the old bug where a
  fresh intern posting at a famous company floored ~77-86 regardless of field (role-fit entered only
  via skillMatch@30%, which defaulted to 0.75 "neutral" when the JD had no recognized skills; company
  signal was a flat 0.70 stub). Now TITLE-primary (the title names the role's field; the JD is noisy
  with company context): on-field title -> 1.0; OFF_FIELD_TITLE_PATTERNS (aero/mechanical/accounting/
  finance/sales/legal/nursing/...) -> 0.35 and the JD can't rescue it; neutral title -> JD-based. The
  multiplier can't be diluted by experience/location/timing, so off-field roles fall below the apply
  threshold. Verified live: Zipline "Aerodynamics Intern" 86 -> 29 (apply=false); ML/SWE/CV roles
  unaffected. Current Ready queue already all on-field (0 off-field to purge). 563 tests.
- To tune aggressiveness: adjust the 0.35/0.7/1.0 tiers or OFF_FIELD_TITLE_PATTERNS in queuePlanning.

## Latest (2026-07-11b) — role focus + broad relevant coverage
- **Role-relevance filter** (5663d84): `isRelevantRole(title)` in queuePlanning (word-boundary
  patterns for AI/ML/SWE/robotics/AV/physical-intelligence; \bai\b never matches "training"). The
  WATCHER now alerts only on postings that are BOTH on-field AND F-1-eligible ("the role matters,
  not the company"). Deliberately NOT applied to sourcing: a title-only filter would false-drop
  generically-titled relevant roles; sourcing keeps its JD-based Evaluator (tighten via scorer
  calibration, a judgment call, not a blunt title filter).
- **Board coverage expanded** (198e1c9) to 28 verified AI/ML/robotics/AV firms (identity + job count
  checked live against each API): GH += databricks, waymo, nuro, figure, samsara, verkada, stripe,
  coinbase, reddit, discord, figma, instacart, robinhood, gitlab, brex; Lever += zoox, palantir;
  Ashby += skydio, cohere, perplexity, sierra, harvey, baseten, modal, replit, notion, ramp,
  benchling. ~50 boards now watched. NOTE: after expanding boards, RE-SEED the watcher
  (`rm data/watch-seen.json`; next run seeds silently) so the new boards' backlog does not flood as
  "new" — done 2026-07-11.
- **terminal-notifier INSTALLED** → new-posting banners are now clickable-straight-to-apply (live).
- **Apply is still human-gated (captcha).** All of Greenhouse/Lever/Ashby carry reCAPTCHA/hCaptcha,
  so a 24/7 UNATTENDED apply loop would submit ~0 + pop windows uselessly. Deliberately NOT set up.
  The real 24/7 flow: source (3h) + watch (5m) run autonomously; Parv applies via the clickable
  alert → `npm run run -- --auto` (solves the captcha, auto-detects the confirmation). 556 tests.

## Latest (2026-07-11) — "be first to apply" watcher (Tsenta-parity, free)
- **`npm run watch`** (src/watch/): scans the FAST no-auth sources (Greenhouse/Lever/Ashby board
  APIs + SWEList/NewGrad) via the new cache-bypassing `Scanner.scanFresh`, diffs a persisted
  seen-set (data/watch-seen.json), and fires an INSTANT desktop notification for each genuinely-new,
  F-1-eligible posting + appends it to data/new-jobs.json (hot-list). Speed-to-apply is the edge
  (first-come-first-served). `detectNewPostings` is pure + unit-tested (first run seeds silently;
  later runs emit only the de-duped delta). NEVER applies — watch + alert only.
- **LIVE via launchd**: `~/Library/LaunchAgents/com.parv.careerops.watch.plist` runs every 5 min
  (RunAtLoad). 5 min (not "every minute") is the honest sustainable cadence — faster hammers the
  public board APIs toward a ban that would break sourcing. Disable:
  `launchctl bootout gui/$(id -u)/com.parv.careerops.watch`. Logs: batch/logs/watch.{out,err}.
- Verified live: seeded 500, simulated delta -> detected 6 new -> 4 F-1-eligible alerted (2
  clearance/citizen filtered) -> hot-list written (Workato/Later/Jump Trading intern roles).
- **Tsenta parity**: career-ops already had the rest of Tsenta's free core (keyword résumé
  tailoring/M6, full verify-or-abstain auto-apply, on-device, F-1 work-auth filtering, email
  tracking); the watcher was the one missing piece (fast discovery "before LinkedIn indexes it").
- CLICK-TO-APPLY built (46a8ef5): Notifier prefers terminal-notifier when installed — a new_posting
  banner carries the apply URL and is clickable straight to the apply page (`-open`), with graceful
  osascript fallback (URL in text) when absent. Activates automatically on `brew install
  terminal-notifier` (not yet installed). Dead Lever slugs ramp/brex/anduril removed (226f202; they
  404'd every run). Two launchd loops run: `...sourcing` (3h, scan+source+expire) and `...watch`
  (5m, new-posting alerts). To add more watched companies: verified tokens in
  config/{greenhouse,lever,ashby}-boards.yml.

## Latest (2026-06-22)
- **`npm run run -- --auto` = THE everyday command (the hybrid loop)**: per Ready job it runs the
  SAME gated autonomous path as --approve (orch.apply: fill -> independent verify -> submit ONLY
  on a green verdict). If a job is captcha-free + verifies, it submits hands-off. If it stops at a
  captcha (auth_required) or an unknown question (needs_input), the two designed human touchpoints
  (already notified), it brings your real Chrome window to the front, fills what's safe, and then
  WATCHES the live page for the real ATS confirmation (your submit) — no terminal prompt, no TTY
  needed (waitForConfirmation, ~5 min default, override with CAREER_OPS_RESUME_TIMEOUT_MS). It marks
  Applied ONLY on an observed confirmation; on timeout the job stays Ready and resurfaces next cycle
  (verify-or-abstain: never claim a submit we cannot observe). Submit stays in ONE place (the
  Autopilot); the takeover never auto-submits. Verified live: launched your Chrome, ran Scale AI
  autonomously, hit reCAPTCHA, routed auth_required, 0 submitted / 0 false records.
- **Honest ceiling unchanged**: today all 5 Ready jobs are reCAPTCHA-gated, so --auto pauses on each
  for you to solve the captcha (it is NOT 100% hands-off; captchas are a hard human touchpoint by
  invariant 6). When fresh captcha-free postings appear, --auto submits them hands-off. "Accuracy"
  here = it never submits a field it could not independently verify; on any mismatch/unknown it
  abstains. It is not "fills every form perfectly."
- **The macOS notification CANNOT deep-link to the page** (osascript banners are attributed to
  Script Editor; clicking opens Script Editor). The fix is NOT the banner: --auto/--attended raise
  the live Chrome window themselves on a touchpoint. Don't tell the user to click the banner.
- **Jack and Jill (app.jackandjill.ai)**: USE AS A JOB SOURCE (Parv 2026-06-22). PARTIALLY DONE
  without needing JnJ access (7af2589): 3 of the 6 saved companies post on public Greenhouse boards,
  added to config/greenhouse-boards.yml with tokens verified live — wayve, togetherai, flyzipline
  (Zipline). A fresh scan now yields e.g. Together AI "Frontier Agents Intern (Fall 2026)". Remaining
  2 (Applied Intuition, pony.ai) are NOT on Greenhouse/Lever under any obvious token (likely Ashby/
  custom) — would need an Ashby BOARD scanner (none exists; only an Ashby FormSource for applying) or
  their direct links. Reading the live JnJ board itself stayed blocked (Control_Chrome content-read
  broken; Claude-in-Chrome extension never connected). Apply on the real ATS pages, never through JnJ.
- 514 tests; typecheck clean. Adversarial diff review: 0 correctness bugs; fixed --auto+--tailor
  silent-drop (now warns) + new-prose em dashes before commit.
- **`--auto` resume FALSE-POSITIVE guard (78883a0)**: the no-TTY auto-resume polls readConfirmation
  on the still-UNSUBMITTED form; Greenhouse/Generic's loose body+URL fallback could read "confirmed"
  pre-submit and falsely mark Applied. Now only a null->confirmed TRANSITION counts (baseline read
  first; if the page already reads confirmed before you act, it abstains and hands it back). Found by
  adversarial review.
- **24/7 sourcing loop is LIVE (launchd)**: `~/Library/LaunchAgents/com.parv.careerops.sourcing.plist`
  runs `scripts/sourcing-loop.sh` every 3h (scan -> source --top 10 -> expire), keeping the Ready
  queue fresh + M6-tailored. SOURCES ONLY, never submits (captcha submit stays a human touchpoint via
  `npm run run -- --auto`). Logs: `batch/logs/sourcing-loop.{out,err}`. Disable with
  `launchctl bootout gui/$(id -u)/com.parv.careerops.sourcing`.
- **CAPTCHA REALITY (verified 2026-06-25)**: probed every distinct ATS in the queue at its exact apply
  URL, headless. Greenhouse (Scale AI/Tenstorrent/Unity) + Ashby (Gen Digital) each have a VISIBLE
  256x60 reCAPTCHA v2 checkbox; PlusAI (Lever) has hCaptcha. NOT invisible v3. The captcha caution is
  correct: every form needs a human checkbox, none are hands-off submittable. (A v2 checkbox often
  auto-passes for a logged-in human, which is why it can feel like "no captcha".)

## Latest (2026-06-20)
- **Greenhouse option-leak FIXED**: `discoverBuiltinFields` was discovering each multi-select
  checkbox option (Austin TX, Summer, ...) as a phantom required text question. Tenstorrent
  People Ops dropped 14 -> 6 real unknowns. Pure `filterBuiltins` (excludes checkbox/radio), tested.
- **Captcha detection now on ALL three FormSources** (Greenhouse, Generic, AND Workday — the
  last was missed initially; adversarial review caught it). Workday driver gained optional
  `hasCaptcha()`. So `--approve` cannot blind-submit into a captcha on any supported ATS.
- **Email tracking is LIVE**: the Gmail app password is already in the vault; `npm run inbox`
  connected and scanned 2782 emails/30d, matched 2. Added `npm run inbox -- --check` (read-only
  login test + precise "user set, password missing" diagnosis).
- **`npm run run -- --preflight --learn`**: records each unknown question to the AnswerInbox
  (data/pending-answers.json, gitignored) for one-time human approval; grows the AnswerKB so
  intervention drops. Questions only, never fabricated answers.
- **Honest ceiling on the current queue**: 5 Ready jobs, ALL classify ATTENDED (captcha +/or
  genuine human-choice questions). 0 AUTO. So NO application is autonomously submittable right
  now; a real submission needs either an attended session (Parv at the keyboard) or new
  captcha-free postings from a fresh scan. The 6 Tenstorrent unknowns (transcript upload, two
  multi-selects, internship length, 40-hours option, export-control attestation) are genuine
  human touchpoints — answering them is forbidden to automate (invariant 1/7).
- **Scan-timing FIXED**: buildSession now settles the page (capped networkidle) before
  scanning — the React form + reCAPTCHA render after domcontentloaded, and a racing scan
  was flip-flopping (one --approve saw "no captcha, 1 unknown"; preflight saw "captcha, 5").
  After the fix, all 5 Ready jobs consistently detect reCAPTCHA.
- **`npm run source -- --top N`**: tailors only the N highest-scoring fresh jobs (score-ranked
  bounded run; the expensive M6 tailor runs only on the best).
- **Autonomous --approve demonstrated on the 5 board-API jobs: 0 submitted, 0 false records** —
  all 5 route to auth_required (reCAPTCHA) or needs_input (unknown questions). The accuracy
  contract held; nothing incorrect reached an employer.
- **Sourcing integrity caveat**: a fresh scan returns ~279 jobs but 267 are scraper-sourced with
  STUB JDs (<160 chars) and `postedAt` = scrape-time (not a real posting date) — they fail
  invariant 9 (freshness) + the no-stub-JD-scoring lesson, so they are NOT auto-submittable.
  Only the ~12 structured board-API jobs (Greenhouse/Lever) carry real dates + full question
  sets, and those are all captcha-gated. Net: NO autonomous submission is possible with
  integrity right now; a real submission needs an attended session (Parv solves the captcha).
- **Chrome + captcha UX FIXED**: the run CLI now launches Parv's real Google Chrome
  (channel 'chrome', fallback Chromium), attended mode is forced headed, and on a human
  touchpoint the Chrome window is raised to the front (page.bringToFront + osascript
  activate). The macOS notification banner opens Script Editor (not the browser), so the
  captcha flow no longer depends on clicking it — the window surfaces itself. Verified live:
  real Chrome 147, attended filled+verified 12 fields on a Tenstorrent form, flagged the
  reCAPTCHA, no submit. THE captcha path is `npm run run -- --attended` in a real terminal.
- 507 tests; demos green (demo:captcha 5/5, demo:integration 6, demo:autopilot 2).

## Latest (2026-06-19) — the HONEST submission paths
Fully-autonomous, zero-human submission is impossible on captcha-protected forms by policy
(invariant 6: never solve a captcha). Two real paths exist; both keep accuracy paramount
(every filled field is read back and verified, or flagged, or handed off — never claimed):
- **`npm run run -- --preflight`** (read-only): scans each Ready job and classifies it
  **AUTO** (no captcha, no required-unmapped, no unknown question, ≥1 fillable -> predicted
  hands-off submittable) vs **ATTENDED** (needs you), with reasons. Never fills, never submits.
  Run this first to point `--approve` only at the captcha-free subset.
- **`npm run run -- --approve`** (autonomous): submits AUTO forms after an independent green
  verdict. A captcha is now detected DURING the scan and routed to `auth_required` BEFORE any
  fill (no blind submit into a wall). Most modern forms hit this -> use attended.
- **`npm run run -- --attended`** (co-pilot, the realistic real-submission path): fills +
  verifies what it safely can in a VISIBLE browser, lists exactly what you must do (captcha,
  genuine multi-selects, the Scale-AI Country widget), you finish + click Submit; the inbox
  tracker confirms from the email. Requires you at the keyboard (synchronous, TTY-gated).
- Captcha detection: `CaptchaDetector` (reCAPTCHA v2 / hCaptcha / Turnstile; invisible v3
  excluded). Selectors proven on real DOM by `npm run demo:captcha` (5/5).
- Still open / non-blocking: email creds not in the vault yet (GMAIL_USER set, app password
  missing -> `npm run inbox` is idle); Scale-AI Country "+1" read quirk (verifier flags it);
  no real application submitted yet (attended needs Parv to finish + submit).

## Where the project is (M3–M7 done)
All subsystems are built AND now INTEGRATED into one cohesive flow. The verify-or-abstain
core runs the real entry point, not just demos.
- **Apply engine (M3, M3.5):** verify-or-abstain form fill. Build an exact IntentPayload
  before any browser mutation, fill, then an INDEPENDENT read-back is diffed by the
  Verifier; unknown/legal/EEO/unmatched -> abstain. Autopilot adds the loop:
  abstain -> macOS notification + AnswerInbox -> resume after the answer is learned;
  verified + explicit BatchApproval -> submit + receipt. Submit is impossible without a
  green verdict AND approval (the filler holds a submit-free surface).
- **Multi-portal (M4):** `ApplicationAdapter` behind an `AtsFormSource` boundary; Workday +
  Greenhouse FormSources share it. Adding Lever/Ashby ≈ one FormSource each.
- **Sourcing (M5):** structured board APIs (Greenhouse first_published + Lever createdAt),
  gated by `FreshnessFilter` (14d) then `TermFilter` (Summer/Fall 2026).
- **Tailoring (M6):** `Tailor` = extract ATS keywords -> no-fabrication injection -> render
  -> independent `ResumeVerifier` -> PDF within page budget. Abstains (no PDF) on any
  verification failure. Never fabricates.
- **Integration (M7):** `Orchestrator` (src/orchestrator/) composes them with verify-or-abstain
  at every seam and adds NO new trust: tailor-gate (verified -> queue Ready; abstain -> not
  queued) -> single event log -> apply-gate (Autopilot fill/verify/gated-submit; unsupported
  ATS -> abstain). One locked `EventStore`; the queue add and every apply event join on
  `appIdFor(company, role)`. `PortalRouter` = support authority; `PlaywrightApplySessionFactory`
  + `GreenhouseBoardJobProvider` = the thin IO edge (abstain before opening a browser).

## The coherent v2 flow (use these three commands)
1. **`npm run scan`** — find jobs (board APIs + scrapers) into the `data/daily_log` cache.
2. **`npm run source`** — freshness + term + score gates, then **M6 verify-or-abstain tailoring**
   into the Ready queue (SourcingPipeline + Orchestrator). The queue is M6-quality by default.
   - `--dry-run` previews the gates without tailoring; `--all-days`, `--limit N`.
3. **`npm run run`** — drive the Ready queue through the Orchestrator: fill + INDEPENDENT
   verify, STOP at ready_to_submit. **Never submits without `--approve`.**
   - `npm run run -- --approve` — submit each job that verifies green (Parv's "button click";
     gated on a verified verdict + idempotency).
   - `npm run run -- --tailor` — re-tailor with M6 before applying (use if the queue was
     populated by the legacy pipeline).
   - `npm run run -- --preflight` — read-only AUTO vs ATTENDED triage (see Latest, above).
   - `npm run run -- --attended` — co-pilot fill + verify + human handoff (see Latest, above).
   - `--batch N` (default 5), `--job ID`, `--stats`.
- Needs config/profile.yml + config/answers.yml + config/scoring.yml + cv/ (gitignored,
  present on Parv's machine).
- Legacy `npm run pipeline` (v1 tailoring) and `npm run apply` (v1 handlers) remain as a
  fallback but are NOT the v2 path.

## Verify the state (run these)
- `npm run typecheck` (clean) and `npx vitest run` (328 passed / 37 skipped / 0 failed as of 2026-06-16).
- `npm run demo:integration` — THE integration proof: one Orchestrator drives the REAL
  SourcingPipeline over a 3-job batch (a stale + an off-term job dropped before tailoring) ->
  M6 tailor (real PDF) -> queue -> apply (fixture portal) -> notify/resume -> gated submit;
  ONE event log (queued→abstained→fill_verified→submitted→confirmed), one appId, status Applied. 5/5.
- `npm run demo:autopilot` (Workday+Greenhouse fixtures), `npm run demo:tailor`, `npm run demo:workday`.
- `npm run run -- --stats` (live queue breakdown) and `npm run source -- --dry-run` (sourcing preview).
- Playwright Chromium installed. Demos/tests use stubs/fixtures, no real PII.

## Hard rules (always)
- NEVER fabricate resume content; tailor = select + reframe REAL experience.
- Submit a real application ONLY behind explicit approval + real creds; demos/loops use
  fixtures only. The verify-or-abstain + approval gate is the safety, not hope.
- Writing style: no em dashes, no AI filler. Profile facts only from profile.yml.
- Tests green before commit. Commit per feature. Adversarial review before done.

## What's left / next candidates (no remaining "milestone gap")
1. **Live verification on Parv's machine** (the only thing that can't run in-loop — needs real
   profile/creds/network): run `npm run source -- --dry-run` then a single real `npm run run --job <id>`
   (no --approve) against one fresh posting to confirm the live fill/read-back; then `--approve`.
   The live Greenhouse board-fetch (GreenhouseBoardJobProvider) is wired but only exercised here.
2. **Cover letters in the sourcing path**: `npm run source` tailors the RESUME (ATS-critical) via M6;
   cover letters are skipped there (the M6 CoverLetterBuilder needs grounded per-job paragraphs).
   Decide a grounded cover-data source if cover letters should be auto-generated at sourcing time.
3. **Lever/Ashby FormSources** (~one file each) -> register in PortalRouter to widen apply coverage.
4. **v1 legacy** (old scrape-scanners feed the cache; old handlers/pipeline are fallback) is the
   remaining untested surface, kept deliberately for sourcing reach + fallback. Retire per-portal as
   v2 FormSources land.

## Map (key entry points)
- Integration: src/orchestrator/{Orchestrator,PortalRouter,PlaywrightApplySessionFactory,
  GreenhouseBoardJobFetcher,index}.ts. Spec: docs/specs/M7-integration.md.
- Apply engine: src/applier/{ApplicationAdapter,Autopilot,Verifier,IntentPayload,AnswerKB,
  AnswerInbox,AnswerGenerator,Notifier,SubmissionRecorder,DomControls}.ts + {Workday,Greenhouse}*.
- Sourcing: src/scanner/{GreenhouseBoardScanner,LeverBoardScanner,Scanner}.ts +
  src/pipeline/{FreshnessFilter,TermFilter,index}.ts.
- Tailoring: src/tailor/*, src/pdf/PdfGenerator.ts, templates/cv-template.html, cv/ (gitignored).
- Store: src/store/{EventStore,Projection,events,ViewWriter}.ts + src/tracker/ApplicationStore.ts.
- Specs: docs/specs/M1..M7. Defect log + decisions: LESSONS.md.

## 2026-07-11 (e) — AnswerKB fully populated + stale-term accuracy fix
- **config/answers.yml (gitignored) is now fully populated** with Parv's approved answers:
  term Fall 2026, 40h yes, duration 3-6 months, part-time-during-school yes, start Aug 17 2026,
  end Dec 15 2026 (open to extend), relocate yes, preferred SF/San Jose, comp "Market rate",
  how-heard LinkedIn, referred no, 1yr experience, criminal-history No, EEO Male/Asian/
  Heterosexual/not-transgender/not-veteran/no-disability, pronouns he/him, preferred name Parv,
  plus the pre-existing sponsorship/non-compete/consent/narrative/attestation entries.
  Verified accurate through the REAL composite chain (AnswerKB→Essay→AnswerGenerator): the
  audit reports 44/44 auto-answered, and the tricky ordering holds — "been convicted?"→No while
  "consent to a criminal background check?"→Yes (criminal-history entry precedes consent).
- **config/profile.yml (gitignored)**: target_roles.start_date 2026-05-11→2026-08-17 (past Summer
  date corrected; endDate now auto-computes to 2026-12-15), terms→["Fall 2026"].
- **Accuracy fix (committed 7594925, clean, no AI signature)**: AnswerGenerator hardcoded
  "Summer 2026" for term/season/session — a now-EXPIRED season that would auto-fill onto a form
  for any phrasing AnswerKB missed (invariant 1) and violated "no personal fact hardcoded in
  source". Now derives from ProfileLoader.getApplicationDefaults().term (target_roles.terms[0],
  default Fall 2026). Broadened AnswerKB term patterns (semester/session/cohort). +2 regression
  tests in ProfileLoader.test.ts. Full suite 567 green, typecheck clean.
- **Human touchpoints left by design**: essays (why-company/role) → EssayAnswerSource grounded on
  profile/github/portfolio, never hardcoded; export-control/ITAR → AnswerGenerator flags for review
  (invariant 7); comp as a numeric-only field → abstains (no fabricated number); captchas.
- **Pipeline health**: both launchd loops loaded + exit 0 (sourcing 3h, watch 2min). Watch scans
  508 postings/cycle. Queue: Applied 9 / Ready 5 / Closed 359. Board configs clean (dead Lever
  anduril/ramp/brex removed earlier; anthropic Greenhouse verified live 200, prior fail was transient).

## 2026-07-12 — apply-loop crash fix + Ready-queue quality finding
- **Ran `npm run run --approve` on the 5 Ready jobs. Result: 0 submitted.** Not a captcha
  problem and not an engine bug — all 5 Ready jobs are Simplify-wrapped aggregator links from
  the SWEList/NewGrad list scrapers, resolving to non-submittable targets:
  BrightAI (job-boards.greenhouse.io) → 404 dead posting; ByteDance ×2 (jobs.bytedance.com) →
  custom ATS, no v2 form source; Blue River (bluerivertechnology.com embedded Greenhouse) →
  unparseable board ref; Tesla (tesla.com) → custom ATS. The engine correctly abstained on all.
- **Crash fixed (committed 974124f)**: the first run CRASHED the whole batch (exit 1) when Blue
  River's fill threw a Playwright scrollIntoView timeout in GenericFormSource.fill and it
  propagated unhandled through Autopilot → Orchestrator → main (job 5 never ran). Now
  ApplicationAdapter.run catches fill/read-back throws → verify_failed (error surfaced in the
  verdict; never submits, notifies, continues), and both CLI loops guard each job. Re-ran
  headless: all 5 processed, Blue River → VERIFY FAILED, Tesla now reached, 0 submitted, exit 0.
  +2 regression tests (ApplicationAdapter.resilience.test.ts). Suite 569 green.
- **Queue integrity**: Applied stayed 9, Ready stayed 5 across both runs — no false success.
- **Real bottleneck for autonomous submits**: the Ready queue must hold CLEAN board URLs
  (job-boards.greenhouse.io/<token>/jobs/<id>, jobs.lever.co, jobs.ashbyhq.com) that the v2
  FormSources can parse. The scan cache DOES have ~9 clean board-URL jobs recently; Applied=9
  suggests those already got applied, leaving the aggregator residue in Ready. NEXT submittable
  work comes from NEW clean board postings (the 2-min watch loop alerts on these first-come).
- **Follow-ups worth a look (not done)**: (a) a UrlResolver that unwraps Simplify → canonical
  ATS URL, and resolves an embedded gh_jid → job-boards.greenhouse.io, would make more list-
  scraper jobs submittable; (b) mark the BrightAI 404 posting Closed (dead, not applicable).
- 2026-07-12 | metrics | parv_corrections=0 repeat_mistakes=0 bugs_found=1 (unhandled fill-throw crashed the apply batch) shipped_first_try=1 rework_commits=0. Fixed with engine-boundary abstain + per-job CLI guards + 2 regression tests; verified by a clean re-run (all 5 processed, exit 0).

## 2026-07-13 — gh_jid embed → /embed/job_app fill fix + Blue River apply attempt
- **URL resolver extended (committed 613a391)**: UrlCanonicalizer now emits the bare
  job-boards.greenhouse.io/embed/job_app?for=<token>&token=<id> form for a resolved gh_jid
  embed (the /jobs/<id> board URL redirects back to the company iframe page for embed-configured
  companies like Blue River). parseGreenhouseRef parses that form URL too. Suite 583 green.
- **2 technical screening answers** (data leakage; nonsensical-predictions) added to config/answers.yml
  (gitignored), Parv-reviewed + approved 2026-07-13.
- **Blue River apply (`--auto --job 400`) result: FILLED, NOT SUBMITTED.** 7 fields filled + verified
  (name, email, phone, resume, LinkedIn, work-auth); the 2 essay textareas typed (maxlength -1, no
  truncation; read-back verify is flaky on the React textarea but content is correct); reCAPTCHA
  present (human touchpoint). The 5-min attended window lapsed with no human submit → left Ready.
  Queue unchanged (9 Applied / 5 Ready). Nothing sent to Blue River.
- **Known remaining gap**: GreenhouseFormSource does NOT reliably fill the new Greenhouse React
  `react-select` location widgets (Country/Location/City) — "Country got +1", City empty. These need
  manual selection or a react-select-aware fill (click to open, type, pick option). This is the next
  concrete autonomous-fill improvement; the resolver + embed-form work is done.
- **To finish Blue River**: run `npm run run -- --auto --job 400` in a terminal, then in the surfaced
  Chrome: set Country=United States + City, glance at the 2 essay answers, solve the reCAPTCHA, click
  Submit. The loop marks it Applied on the real ATS confirmation.

## 2026-07-13 (b) — react-select fill support in DomControls
- **Built (committed dd95f41)**: DomControls react-select fill now waits for the menu to render
  (options.first().waitFor) so async typeaheads (city/location) populate, then selects ONLY a
  confident match via the pure `confidentOptionIndex` (exact after stripping a trailing "+dialcode",
  or a UNIQUE prefix); ambiguous → Escape, field left unset (never guesses). 7 new unit tests
  (matcher + normalize + integration); suite 590 green; typecheck clean.
- **Verified live on Blue River**: Country → selects "United States" (widget shows "+1"); City "San
  Jose" → abstains (was wrongly picking "San Jose, Antique, Philippines"). Clean react-selects
  (Yes/No, pronouns, degree) now fill AND verify green — the broad win.
- **Two residual follow-ups (NOT done; flagged for decision)**:
  1. Location answers need City+FULL STATE to confidently match the typeahead: probe showed
     "San Jose, California" → selects "San Jose, California, United States", but "San Jose" and
     "San Jose, CA" do not. A small AnswerGenerator tweak (emit "City, <Full State>") would make
     City auto-fill.
  2. Auto-VERIFY of divergent-display selects needs a Verifier change: a searchable select's
     read-back legitimately differs from the typed intent (Country reads "+1"; City reads "San Jose,
     California, United States"). Strict norm-equality flags these for a human even when correct. A
     NARROW anchored-prefix acceptance (read-back starts with intent) would auto-verify them, but it
     touches invariant 1 (LESSONS caution against loosening option matching) — needs Parv's sign-off.
- 2026-07-13 | metrics | parv_corrections=0 repeat_mistakes=0 bugs_found=1 (react-select fill: no async wait + exact-only match → null/wrong-city) shipped_first_try=1 rework_commits=0. Diagnosed live, fixed with wait + confident-match + safe abstain, 7 regression tests, live-verified.

## 2026-07-13 (c) — location auto-fill + Verifier comma-qualified select acceptance
- **Committed a3f036e**: (1) AnswerGenerator answers a COMBINED location field (Greenhouse
  "Location (City)"/candidate-location) with "City, <Full State>" ("San Jose, California") via a
  US state abbrev->name map, placed before the plain-city branch (a bare "City" field still gets
  just "San Jose"); (2) Verifier accepts an option read-back that is the intent plus a COMMA-
  qualifier (typed "San Jose, California" -> "San Jose, California, United States"), anchored on
  the comma so "United States" is NEVER satisfied by "United States Minor Outlying Islands"
  (invariant 1). 7 new tests; suite 597 green; typecheck clean.
- **Verified live (real chain: ProfileLoader->AnswerGenerator->DomControls->Verifier on the Blue
  River embed form)**: candidate-location fills "San Jose, California, United States" -> VERIFY
  PASS. Country still reads "+1" (phone dial-code widget) -> VERIFY FAIL (human glance); that is a
  distinct phone-country selector, not the location typeahead, and is an accepted residual (the
  field IS set to US; the form has a reCAPTCHA the human solves anyway).
- **Net for a modern Greenhouse form**: standard fields + essays + Location (City) + clean
  react-selects (Yes/No, pronouns, degree) now fill AND verify green autonomously; the human is
  left with the reCAPTCHA (+ a glance at the phone-country "+1"). That is the ~90% ceiling.
- 2026-07-13 | metrics | parv_corrections=0 repeat_mistakes=0 bugs_found=0 (planned follow-ups #1+#2) shipped_first_try=1 rework_commits=0. Location answer specificity + narrow anchored Verifier acceptance; live-verified City fills+verifies; negative case (space-continuation) rejected.

## 2026-07-15 — FIRST SUBMISSION (Nuro) + EEO autofill + headless autonomous pass
- **Nuro Software Engineer, Performance - New Grad SUBMITTED** (app 402 -> Applied, confirmed via
  job-boards.greenhouse.io/embed/job_app/confirmation). First real end-to-end submission: URL
  resolver + tailoring + react-select fill + human captcha. Queue now Applied 10.
- **EEO autofill (committed 57c6572)**: map job.compliance into a separate complianceFields list,
  DOM-gate the ids (API "race" renders as DOM "hispanic_ethnicity" -> excluded), builder skips an
  optional option-field with no exact match instead of blocking, AnswerKB EEO patterns given short
  CamelCase-robust forms ("gender","veteran"). Live-verified on Nuro: gender + veteran auto-fill
  from the approved AnswerKB; disability skips (its approved wording != the form's exact option);
  race excluded. answers.yml pattern tweak is local (gitignored).
- **Headless autonomous pass (committed 137fe62)**: --auto now runs the autonomous pass HEADLESS;
  a headed window is launched lazily ONLY at a human touchpoint. Captcha-free work is fully
  invisible. LIMITATION: a captcha job's takeover window still appears (the human solves the
  captcha in that filled form); fully hiding it needs minimize/off-screen tricks that risk
  breaking react-select/async fills (throttling) -> left opt-in.
- **Open items**: (1) disability EEO fills only when the approved wording exactly matches the
  form's option (varies) -> currently a 1-click human pick; (2) the phone-country "+1" verify
  papercut (left, per Parv); (3) optional: minimize the captcha-takeover window during fill.
- 2026-07-15 | metrics | parv_corrections=1 (screen-stealing UX + EEO not filled) repeat_mistakes=0 bugs_found=2 (EEO never fillable; --auto stole screen) shipped_first_try=1 rework_commits=0. First real submission landed; both corrections fixed with tests + live verification.
