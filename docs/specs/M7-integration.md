# SPEC M7: Integration — one cohesive pipeline across all subsystems

> Status: in progress. Written 2026-06-16. This is THE integration milestone:
> the four/five subsystems shipped in isolation (M3–M6) are wired into one
> end-to-end flow through the single event log. No new subsystem; the work is
> the seams, the gates between stages, and one real entry point.

## The problem (why this milestone exists)
M3–M6 each shipped verified and demo-proven in isolation, but the production
entry points still run the **v1 legacy path**:
- `npm run pipeline` tailors with `VariantClassifier` + `CoverLetterPersonalizer`
  + pre-built variant PDFs. It does NOT call the M6 `Tailor` (verify-or-abstain).
- `npm run apply` drives the v1 `*Handler` classes and "NEVER submits". It does
  NOT use the M4 `ApplicationAdapter` / M3.5 `Autopilot` verify-or-abstain engine.

The M3–M6 core only runs in `demo:*` scripts. Integration = make the real flow
USE the verified core, end to end, through one event log.

## The end-to-end flow (target)
```
sourced Job  (GreenhouseBoardScanner / LeverBoardScanner)
  -> FreshnessFilter (14d) -> TermFilter (Summer/Fall 2026)        [exists, keep]
  -> Evaluator.evaluate -> shouldApply gate                         [exists, keep]
  -> TAILOR  (Tailor.tailor: extract->inject->render->verify->PDF)  [M6]
       gate: result.verified === true (pdfPath set), else ABSTAIN  (no queue)
  -> QUEUE   (ApplicationStore.add: queued event -> status Ready)   [single writer]
  -> APPLY   (Autopilot: fill -> independent read-back -> verify)   [M4/M3.5]
       gate: submit ONLY on verified verdict + explicit BatchApproval
       -> needs_input / verify_failed / auth_required -> notify, STOP
       -> submitted -> SubmissionRecorder receipt + status -> Applied
```
Idempotency by `appIdFor(company, role)` at both gates. One shared
`EventStore` at `data/events.jsonl`: the queue add and the apply events live in
the same log, joined by appId.

## What gets built (the seams, nothing more)
1. **`ApplicationStore.events()`** — expose the store's single `EventStore` so
   the recorder, the idempotency check, and the queue view all use ONE locked
   instance (provably single-writer, one lock).
2. **`Orchestrator`** (`src/orchestrator/Orchestrator.ts`, pure core):
   - `tailorAndQueue(job, evaluation, coverData?)` -> tailor-gate -> queue.
     On `!verified`: record/notify the abstain, return `tailor_abstained`, do
     NOT queue (a `Ready` app always has a verified, shippable PDF).
   - `apply(application, { approval? })` -> open a portal session via the
     factory -> run `Autopilot` -> close. Maps the AutopilotResult.
   - `advance(job, evaluation, { approval?, apply })` = tailorAndQueue then,
     if Ready and apply requested and the ATS is supported, apply.
   - Deps injected (TailorStep, ApplySessionFactory?, ApplicationStore,
     Notifier, AnswerInbox, answers-source builder). Autopilot owns apply
     events; the orchestrator owns only the queue add (no double-record).
3. **`PortalRouter`** (pure): ATS string -> supported portal kind | unsupported.
   An unsupported ATS ABSTAINS (never guesses a filler).
4. **`ApplySessionFactory`** interface + two impls:
   - `FixtureApplySessionFactory` (tests/demo: file:// pages, no network),
   - `PlaywrightApplySessionFactory` (Workday via WorkdayDriver(page),
     Greenhouse via GreenhouseFormSource(page, boardJson)). Board JSON comes
     from an injected provider (scanner-persisted in prod, fixture in demo).
5. **`scripts/demo-integration.ts`** (`npm run demo:integration`): the WHOLE
   chain on fixtures — sourced job -> filter -> evaluate -> tailor (real M6,
   real PDF in headless Chromium) -> queue -> apply (fixture portal) ->
   submit-on-approval -> print status transitions + the shared event log. THE
   evidence the subsystems cohere.
6. **Entry points**: a new `src/orchestrator/index.ts` CLI (`npm run run`) over
   the real ApplicationStore + Playwright factory + approval gate (the v2
   replacement for `npm run apply`). The v1 CLIs stay reachable as legacy.

## Apply the discipline that built M3–M6
- Maker/checker preserved: the orchestrator never fills or judges; it composes
  the Tailor (its own verifier) and the Autopilot (filler + independent
  Verifier + gated submit). It adds NO new trust.
- Verify-or-abstain at every seam: tailor abstain stops the queue; an
  unsupported ATS abstains; the Autopilot's gates are unchanged.
- Single writer: one `EventStore`. The orchestrator adds the `queued` event;
  the Autopilot/recorder add apply events. Recording lives in exactly one layer
  per stage (LESSONS 2026-06-16).
- Pure core + thin IO: the Orchestrator + PortalRouter are pure/unit-tested
  with fakes; Playwright session-opening is the thin edge, exercised by the
  fixture demo (same model as demo:autopilot).
- One feature at a time, each gated on `npm run typecheck` + `npx vitest run`.
  Adversarial review of the diff before "done". Append LESSONS.

## Tests first (vitest, no real PII, temp stores)
- Orchestrator: tailor verified -> queued Ready with pdfPath; tailor abstain ->
  NOT queued, returns tailor_abstained, notifies.
- Orchestrator apply: verified+approval -> submitted, status flips to Applied in
  the SAME store; verify_failed -> no submit; idempotent (already-submitted
  short-circuits before re-touching the form); unsupported ATS -> abstain.
- advance(): full chain with fakes lands queue + apply events in ONE log,
  joined by appId.
- PortalRouter: greenhouse/workday supported; lever/ashby/unknown -> unsupported.

## Exit gate
The orchestrator drives a sourced fixture job all the way to submitted (fixture
portal) under verify-or-abstain; a tailor abstain and a verify_failed both stop
before submit; idempotency holds; the queue add and the submit land in one
event log joined by appId; `npm run demo:integration` is green; typecheck clean;
full suite green; adversarial review clean; LESSONS + HANDOFF + memory updated.

## Out of scope
Live submission to real employers in the loop (needs Parv's approved batch +
real creds; demos use fixtures only — hard rule). New ATS portals beyond
Workday/Greenhouse (Lever/Ashby FormSources are a later ~one-file each). Any
change to the M6 tailoring logic or the M3–M5 cores.
