# HANDOFF — career-ops-v2
> Read at session start (CLAUDE.md load order). Last updated 2026-06-16.
> Branch: feat/v2-foundation. MODE: BUILD.

## Next milestone (start here)
**M6: resume + cover-letter tailoring.** Full brief: `docs/specs/M6-tailoring.md`.
This is the only remaining major subsystem. Start by reading that spec, then
`LESSONS.md`, then the existing tailor code (`src/tailor/*`, `src/pdf/PdfGenerator.ts`).
Apply the same discipline that built M3-M5: maker/checker split, verify-or-abstain,
pure core + thin IO, one feature at a time gated on typecheck + vitest, adversarial
review before "done", honest evidence (command + output), append LESSONS.

## What is DONE and working (M3-M5, this session 2026-06-16)
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
- `npm run typecheck` (clean) and `npx vitest run` (226 passed / 43 skipped / 0 failed as of 2026-06-16).
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
