# SPEC M2: Greenhouse adapter with verify-or-abstain and receipts
> Status: approved direction, pre-implementation. Written 2026-06-11. Submission allowed per AGENTS.md project override.

## Goal
One ATS, end to end, autonomous: given a batch-approved Greenhouse job, build the payload, fill, verify every field independently, submit, capture the receipt, record events. Any uncertainty = abstain + notify, never guess.

## Order of work (store debt first, then adapter)
1. **Store extension** (pays the M1 review debt before receipts depend on it):
   - `EventStore.appendGroup(inputs[], correlationId)`: one lock, all-or-nothing append of correlated events (receipt-before + submitted + receipt-after must never half-land).
   - `append` gains a non-throwing variant returning a verdict (`{ appended: false, reason }`) so callers stop branching on exception type.
   - Projection cache keyed on (file size, last seq) to kill the per-call full refold; `appendMany` for batch writers.
2. **IntentPayload**: pure builder from profile.yml + AnswerGenerator for one job: the exact list of (field, intended value, source fact, confidence). Built BEFORE the browser opens; this is what the Verifier checks against. Unknown/low-confidence answers mark the payload `abstain` and stop before any browser work.
3. **GreenhouseAdapter v2**:
   - Prefer the board API: `GET boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?questions=true` gives the authoritative field schema; map IntentPayload onto it. POST submit where the board key is exposed client-side; DOM path otherwise.
   - DOM path reuses UniversalFormFiller's native-setter technique; dropdowns match exact-normalized only (no first-option fallback, no substring).
4. **Verifier** (separate class, never the filler): after fill, read every field value back from the DOM (or API echo), diff against IntentPayload. Free-text fields additionally judged by a fresh LLM call with no fill context. Output: per-field PASS/FAIL list. One FAIL = abstain.
5. **Receipt**: `{ appId, correlationId, ts, fields: [...], resumeSha256, screenshotPaths, atsConfirmation }` written via appendGroup around the submit. Screenshot before and after submit.
6. **Notifier**: macOS notification via osascript/terminal-notifier: urgent (captcha, abstain, unknown question) and digest (batch complete). Captcha = notify + pause + headful takeover window, then resume.

## Tests first
1. IntentPayload golden tests from fixture profile (incl. abstain on unknown question).
2. Fixture greenhouse.html: fill -> read-back verify catches a deliberately wrong fill (mutation test: Verifier must FAIL when the filler is sabotaged).
3. Dropdown matcher: exact-normalized matches; near-miss abstains (regression on v1's first-option fallback).
4. appendGroup atomicity: failure mid-group leaves zero of the group's events.
5. Receipt schema round-trip; notifier smoke (dry-run flag).

## Exit gate
10 real Greenhouse applications from a Parv-approved batch: zero unverified submissions, zero blank mandatory fields, every receipt archived with ATS confirmation, every unknown question flagged and queued (not guessed), captcha path exercised at least once if encountered.

## Blocked on Parv
- Rotate Apify token + Handshake password (M0 leftover) before any live run.
- First batch approval (10 Greenhouse jobs from the 331 Ready queue).

## Non-goals
Lever/Ashby (M3), AnswerKB persistence loop (M3), generic agent + ActionCache (M4), LinkedIn (never).
