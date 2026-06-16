# HANDOFF — career-ops-v2
> Read at session start (CLAUDE.md load order). Last updated 2026-06-16 (M6 done).
> Branch: feat/v2-foundation. MODE: BUILD.

## Next milestone (start here)
**M6 tailoring is DONE and green** (this session, see below). All major subsystems
(M3 apply engine, M4 multi-portal, M5 sourcing, M6 tailoring) now exist. Remaining
work is integration + going live, not a new subsystem:
- Drop Parv's REAL cv/ files (master.md + variants) and config/profile.yml on the
  dev machine; run `npm run prep` to pre-render variant PDFs. The tailor + apply
  engine then run against real data (tests/demos stay on fixtures, no PII).
- Wire `Tailor.tailor()` output (pdfPath/coverLetterPath, gated on `verified`)
  into the batch/apply flow so a tailored, verified resume feeds Autopilot.
- Then a small end-to-end: scan -> evaluate -> tailor (verify) -> apply (verify).
Apply the same discipline throughout: maker/checker split, verify-or-abstain,
pure core + thin IO, one feature at a time gated on typecheck + vitest, adversarial
review before "done", honest evidence (command + output), append LESSONS.

## What is DONE and working (M6 tailoring, this session 2026-06-16)
- **Pipeline:** `Tailor.tailor(job, evaluation, coverLetterData?)` runs
  extract -> no-fabrication inject -> render -> VERIFY -> PDF (only if green,
  2-page budget). `Tailor.tailorResume` is the pure, browser-free stage.
- **Pure core (unit-tested, src/tailor/):** `KeywordExtractor` (full JD ->
  ranked/deduped keywords, abstains on a stub), `InjectionPlanner` (injects a
  keyword ONLY if attested in master.md and missing from the variant, into the
  skills enumeration; never alters a claim; skips + surfaces the rest), `text.ts`
  (one whole-token matcher shared so extractor/planner/verifier can't drift).
- **Maker/checker:** `ResumeRenderer` (markdown + ContactFacts -> HTML, fills
  every placeholder; contact from profile.yml only) vs `ResumeVerifier` (parses
  output back: structural floor >= 3 sections, contact matches profile, claimed
  keywords appear, no leaked {{placeholder}}, page budget; mutation-tested).
  `CoverLetterBuilder` vs `CoverLetterVerifier` (extended FORBIDDEN_PHRASES, em
  dash, names company+role, grounded, no placeholder) -> build ABSTAINS (writes
  nothing) on any failure.
- **Thin IO:** `PdfGenerator.htmlToPdf` (Playwright, returns pageCount+bytes,
  absolute font paths + ATS Unicode normalization). Template `cv-template.html`
  reworked to a {{BODY}} slot + {{CONTACT_ROW}} (the pre-M6 template leaked
  placeholders into every PDF). `npm run prep` (PrepareResumes) rewired onto it.
- **Demo:** `npm run demo:tailor` — fixture profile/CV, GREEN (verify->PDF+cover)
  and ABSTAIN (over-budget rejected) both PASS, exit 0.

## What is DONE and working (M3-M5, prior session 2026-06-16)
- **Apply engine (M3, M3.5):** verify-or-abstain form filling. Build an exact
  IntentPayload before any browser mutation, fill, then an INDEPENDENT read-back
  is diffed by the Verifier; unknown/legal/EEO/unmatched -> abstain. Autopilot
  adds the loop: abstain -> macOS notification (Notifier) + AnswerInbox -> resume
  after the answer is learned; verified + explicit BatchApproval -> submit +
  receipt (SubmissionRecorder). Submission is gated: impossible without a green
  verdict AND approval (the filler holds a submit-free surface).
- **Multi-portal (M4):** `ApplicationAdapter` is the ATS-agnostic core behind a
  `AtsFormSource` boundary (`src/applier/ApplicationAdapter.ts`). Portals are just
  a FormSource + SubmitDriver: `WorkdayFormSource`/`WorkdayDriver` (DOM,
  data-automation-id) and `GreenhouseFormSource` (board-API schema + DOM ids).
  Shared `DomControls` for fill/read. Adding Lever/Ashby ≈ one file each.
- **Sourcing (M5):** structured, no-auth, real-date, full-JD board APIs:
  `GreenhouseBoardScanner` (first_published) + `LeverBoardScanner` (createdAt,
  commitment tag). `FreshnessFilter` (14-day) then `TermFilter` (Summer/Fall 2026,
  excludes only provably off-term) gate the pipeline before queueing.

## Verify the state (run these)
- `npm run typecheck` (clean) and `npx vitest run` (280 passed / 37 skipped / 0 failed as of 2026-06-16, M6 done).
- `npm run demo:tailor` — fixture profile/CV: tailor->verify->PDF+cover (GREEN) and over-budget rejection (ABSTAIN), both PASS.
- `npm run demo:autopilot` — Workday + Greenhouse fixtures: abstain->notify->resume->verify->submit (fixture), 2/2.
- `npm run demo:workday` — single-portal verify demo.
- Playwright Chromium is installed. config/profile.yml + config/answers.yml are
  gitignored and ABSENT in a fresh clone; tests/demos use stubs/fixtures, no real PII.

## Hard rules carried into M6 (and always)
- NEVER fabricate resume content; tailor = select + reframe REAL experience.
- NEVER auto-submit a real application to a real employer in a build/demo loop;
  real submit needs explicit approval + real creds. Demos use local fixtures only.
- Writing style: no em dashes, no AI filler. Profile facts only from profile.yml.
- Tests green before commit. Commit per feature. Adversarial review before done.

## Working style (Parv, observed)
- One milestone per FRESH Claude Code session. At each clean green checkpoint,
  refresh this HANDOFF + the auto-memory, then start a fresh session for the next
  milestone (keeps context focused / quality high).
- When a session grows large (~400K tokens), proactively refresh HANDOFF + memory
  so a `/compact` or fresh start never loses context.

## Map (key entry points)
- Apply engine: src/applier/{ApplicationAdapter,Autopilot,Verifier,IntentPayload,
  AnswerKB,AnswerInbox,Notifier,SubmissionRecorder,DomControls}.ts +
  {Workday,Greenhouse}* sources/drivers.
- Sourcing: src/scanner/{GreenhouseBoardScanner,LeverBoardScanner,Scanner}.ts +
  src/pipeline/{FreshnessFilter,TermFilter,index}.ts.
- Tailoring (M6 target): src/tailor/*, src/pdf/PdfGenerator.ts, generate-pdf.mjs,
  templates/cv-template.html, cv/ (gitignored).
- Store: src/store/{EventStore,Projection,events}.ts (append-only event log).
- Specs: docs/specs/M2..M6. Defect log + decisions: LESSONS.md.
