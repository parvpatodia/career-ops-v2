# SPEC M3: Workday adapter with verify-or-abstain (fill + verify only)

> Status: approved direction, pre-implementation. Written 2026-06-15.
> Mirrors docs/specs/M2-greenhouse-adapter.md. This session's hard safety
> constraints (below) are TIGHTER than the AGENTS.md project override.

## Goal
Given a Workday application form, build the exact IntentPayload BEFORE any
browser action, fill the form, then independently read every field back from
the live DOM and diff it against the payload. Unknown / low-confidence / legal
/ EEO answers abstain and stop. Stops at "verified, awaiting human" — this
session NEVER submits.

## Hard safety constraints (this session, non-negotiable)
1. Never submit. There is no submit code path. The driver interface has no
   submit method, so submission is structurally impossible, not merely skipped.
2. Never run against a real live posting. Develop and demonstrate against the
   local fixture `tests/demo/fixtures/workday.html` only.
3. Stop at fill + verify with an explicit human-in-the-loop gate. A green
   verify produces outcome `verified` = "human must review and click Submit".
4. No secrets. config/profile.yml and cv/ stay gitignored; tests and the demo
   use stubs, never personal data.

## Why Workday differs from Greenhouse (and what carries over)
- Greenhouse exposes an authoritative field schema via the boards API
  (questions=true). Workday has no such public schema: it is a React SPA whose
  fields carry stable `data-automation-id` attributes, behind an auth wall, in
  a multi-step wizard. So the schema is read from the DOM, not an API.
- CARRIES OVER UNCHANGED (ATS-agnostic, reused as-is): IntentPayloadBuilder,
  Verifier, AnswerKB + CompositeAnswerSource, SubmissionRecorder.
- NEW for Workday: a DOM-shaped schema mapper and a Playwright driver, plus
  the orchestrator that wires the pure layer together (the "browser glue" M2
  deferred), here built behind a driver interface so it is unit-testable
  without a browser.

## Components
1. **WorkdaySchemaMapper** (pure): `WorkdayRawField[]` -> `WorkdayMappedSchema`.
   Mirrors GreenhouseSchemaMapper properties:
   - Nothing silently dropped: unknown widget types land in `unmapped`.
   - Option texts preserved for select/multiselect/radio.
   - EEO / self-identification fields are routed to `eeo[]`, never to fillable
     `fields[]` (the structural parallel to Greenhouse's demographic_questions).
     IntentPayloadBuilder's LEGAL_PATTERNS gate is the second, label-based net.
2. **WorkdayPageDriver** (interface): `isAuthWall()`, `scan()`, `fill(intent)`,
   `readBack(field)`. No submit method, by design (constraint 1).
3. **WorkdayAdapter** (orchestrator, depends on the interface): authwall ->
   scan -> map -> IntentPayloadBuilder -> (abstain stops before any fill) ->
   fill each intent -> read every field back -> Verifier -> record
   fill_verified / abstained. Outcome is exactly one of:
   `auth_required | abstained | verify_failed | verified`. Never submits.
4. **WorkdayDriver** (Playwright impl): thin glue over a Page. The DOM scan
   returns raw descriptors only; all interpretation lives in the pure mapper.
5. **WorkdayHandler** (rewired): thin Applier subclass that runs the adapter
   over a WorkdayDriver and translates the outcome to ApplyResult, so the
   production apply CLI and demo use the M3 pipeline. Class name + shape kept
   so existing references (index.ts, HandshakeHandler) are untouched.

## Tests first (vitest, pure, no browser, no profile.yml)
1. Mapper: text/select/file/checkbox mapped; unknown widget -> unmapped (not
   dropped); option texts preserved; EEO field routed to eeo[] not fields[].
2. Adapter happy path (fake driver): known fields -> verified, fill_verified
   (pass) recorded.
3. Adapter mutation/sabotage: fake driver returns a wrong read-back for one
   field -> verify_failed, exactly one failing check, NO submit.
4. Adapter abstain-before-browser: unknown required question -> abstained,
   `driver.fill` never called, abstained event recorded.
5. Adapter EEO routing: a self-ID field is surfaced, never filled.
6. Adapter auth wall: isAuthWall true -> auth_required, no scan/fill.
7. Never-submit invariant: across every path, the event log contains no
   `submitted` event.

## Browser evidence (not in the vitest gate)
`scripts/demo-workday.ts`: drives WorkdayDriver + WorkdayAdapter against
`tests/demo/fixtures/workday.html` in headless Chromium with a STUB answer
source (no profile.yml). Proves the real-DOM read-back + verify loop. Run
manually; not part of `npx vitest run` (keeps the gate browser-free, per the
M0 fresh-clone lesson).

## Exit gate (this session)
All vitest pure tests green; typecheck clean; the demo script reaches outcome
`verified` against the fixture with a green per-field read-back table; zero
submit paths in the diff; honest report of what was and was not run live.

## Deliberately deferred (out of scope this session, by the safety constraints)
- Submission + receipt around submit (SubmissionRecorder.recordSubmission):
  exists from M2, intentionally not invoked. A future session re-enables it
  under the AGENTS.md batch-approval + verifier-green + receipt conditions.
- Multi-step wizard traversal (Next/Continue across pages) and Workday account
  vault / login: both require a live tenant and credentials, which constraint 2
  forbids. The adapter processes one step; multi-step is the next increment.

## Non-goals
Lever/Ashby (M4), generic agent + ActionCache (M4), LinkedIn (never).
