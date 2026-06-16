# HANDOFF — career-ops-v2
> Read at session start (CLAUDE.md load order). Last updated 2026-06-16 (M7 integration done).
> Branch: feat/v2-foundation. MODE: BUILD.

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
