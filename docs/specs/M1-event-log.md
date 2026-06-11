# SPEC M1: Event-log data layer
> Status: approved direction, pre-implementation. Written 2026-06-11. Implements AGENTS.md invariants 3 and 4.

## Problem
v1 stores all state in data/applications.json via read-modify-write from three different writers with no locking. Three code paths replace the file with an empty or partial array when a parse fails (applier/index.ts, pipeline/index.ts, tracker/ApplicationStore.ts). The tracker is the system's only memory; it must be impossible to lose.

## Design
Append-only JSONL event log as the single source of truth. State is a projection over events. applications.json becomes a generated view (kept because the global logging rule requires it).

- `data/events.jsonl`: one JSON event per line, append-only. Appends go through a single EventStore class holding an advisory lock (lockfile with O_EXCL + stale-lock timeout). Nothing ever rewrites this file. A corrupt line is skipped with a warning event appended; prior history is untouched by construction.
- Event envelope: `{ seq, ts, type, appId, payload }`. appId = sha256(normalize(company) + '|' + normalize(role)).slice(0,12), the idempotency key.
- Event types (v1 of the schema, closed set): `discovered, scored, queued, fill_attempted, fill_verified, abstained, submitted, confirmed, closed, answer_flagged, answer_approved, note`.
- `Projection` class folds events into per-application state. Illegal transitions (e.g. `submitted` on an appId that already has `submitted`) are rejected at append time by EventStore consulting the projection. This is the double-submit guard.
- `ViewWriter` regenerates data/applications.json from the projection: write to tmp file, fsync, atomic rename. Never read-modify-write.
- Migration: `scripts/migrate-legacy.ts` reads the existing applications.json (370 records) and emits one `discovered` + state-appropriate event per record with `payload.legacy = true`. Run once, verified by count and spot checks, original file preserved as `data/applications.legacy.json` (gitignored).

## Class layout (S in SOLID: one class, one responsibility)
- `src/store/EventStore.ts`: append, read-all, lock management. No business logic.
- `src/store/Projection.ts`: fold events to state, expose queries (byId, byStatus, duplicates). Pure, no I/O.
- `src/store/ViewWriter.ts`: projection -> applications.json view, atomic.
- `src/store/events.ts`: event types + zod-free runtime validation (hand-rolled, no new deps).
- v1 writers (applier, pipeline, tracker) are switched to EventStore in M1; their direct fs writes are deleted.

## Tests first (TDD order)
1. Corrupt line in events.jsonl: projection skips it, all other events intact, append still works. (The v1-killer regression test.)
2. Duplicate `submitted` for same appId: append rejected with typed error.
3. Two EventStore instances appending concurrently: lock serializes, no interleaved/lost lines (spawn two processes).
4. ViewWriter output is byte-stable and atomic: kill-during-write leaves old view intact (write to tmp asserted).
5. Migration: 370 legacy records -> 370 appIds, status distribution matches v1 counts (349 Ready etc.).
6. Property: random event sequences never throw, projection state machine only reaches legal states.
All tests use synthetic fixtures. No skipIf needed: this layer never touches personal data files.

## Exit gate
Fresh clone: npm ci, full suite green including all six test groups above. Local: 108 existing tests still green. Migration executed once on the real tracker with verified counts.

## Non-goals (deferred)
SQLite (revisit if query needs grow), AnswerKB storage (M3, will reuse EventStore), receipts schema (M2).
