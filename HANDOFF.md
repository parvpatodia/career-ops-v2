# HANDOFF — career-ops-v2
> Read at session start (CLAUDE.md load order). Last updated 2026-07-11 (new-posting watcher: be first to apply).
> Branch: feat/v2-foundation. MODE: BUILD.

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
- OPEN / next: notifications are NOT clickable-to-open (osascript opens Script Editor); the apply
  URL is in the banner text + data/new-jobs.json. True click-to-apply needs terminal-notifier
  (`brew install terminal-notifier`) — offered, not installed. Two launchd loops now run:
  `...sourcing` (3h, scan+source+expire) and `...watch` (5m, new-posting alerts).

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
