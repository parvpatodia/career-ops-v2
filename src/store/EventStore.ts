/**
 * The single write path for all job-application tracker state (AGENTS.md
 * invariant 4). EventStore owns the job-application meaning: the event-type
 * whitelist, the seq numbering, and the Projection transition guard. The
 * append-only IO, advisory lock, and incremental read cache live in JsonlLog,
 * shared with the outreach log.
 *
 * WHY events, not CRUD: v1 lost data via read-modify-write of one JSON file
 * from three unlocked writers (LESSONS.md 2026-06-10). An append-only log
 * cannot lose prior records, and every state change keeps its history.
 */

import { Projection } from './Projection.js';
import { validateEvent, isValidAppId, EVENT_TYPES } from './events.js';
import type { AppEvent, EventType } from './events.js';
import { JsonlLog } from './JsonlLog.js';

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

export interface AppendInput {
  type: EventType;
  appId: string;
  payload?: Record<string, unknown>;
}

export class EventStore {
  private readonly log: JsonlLog<AppEvent>;

  constructor(filePath = 'data/events.jsonl') {
    this.log = new JsonlLog<AppEvent>(filePath, validateEvent);
  }

  readAll(): { events: AppEvent[]; corruptLines: number } {
    const { records, corruptLines } = this.log.read();
    return { events: records, corruptLines };
  }

  projection(): Projection {
    // WHY fold per call: callers get snapshot semantics (a handed-out
    // projection never mutates when new events land). The expensive part,
    // file IO and JSON parsing, is what JsonlLog's cache removes.
    const proj = new Projection();
    for (const e of this.log.read().records) proj.apply(e);
    return proj;
  }

  /**
   * Validate, guard, and append one event. Throws TransitionError when the
   * projection rejects the transition (e.g. duplicate submitted).
   */
  append(input: AppendInput): AppEvent {
    return this.appendGroup([input])[0]!;
  }

  /** append() that reports an expected rejection as a value instead of an exception. */
  tryAppend(input: AppendInput): { ok: true; event: AppEvent } | { ok: false; reason: string } {
    try {
      return { ok: true, event: this.append(input) };
    } catch (err) {
      if (err instanceof TransitionError) return { ok: false, reason: err.message };
      throw err;
    }
  }

  /**
   * All-or-nothing append of correlated events under one lock. Later events
   * are validated against a rolling projection that already includes the
   * earlier ones, so submitted+confirmed can land as a pair.
   */
  appendGroup(inputs: AppendInput[], cid?: string): AppEvent[] {
    if (inputs.length === 0) throw new Error('appendGroup: empty group');
    for (const input of inputs) {
      if (!(EVENT_TYPES as readonly string[]).includes(input.type)) {
        throw new Error(`Unknown event type: ${input.type}`);
      }
      if (!isValidAppId(input.appId)) {
        throw new Error(`Invalid appId (want 12 hex chars): ${input.appId}`);
      }
    }

    return this.log.append((records) => {
      const proj = new Projection();
      for (const e of records) proj.apply(e);

      let seq = records[records.length - 1]?.seq ?? 0;
      const ts = new Date().toISOString();
      const events: AppEvent[] = [];
      for (const input of inputs) {
        const event: AppEvent = {
          seq: ++seq,
          ts,
          type: input.type,
          appId: input.appId,
          payload: input.payload ?? {},
          ...(cid !== undefined ? { cid } : {}),
        };
        const verdict = proj.canApply(event);
        if (!verdict.ok) throw new TransitionError(verdict.reason);
        proj.apply(event);
        events.push(event);
      }

      return { lines: events.map((e) => JSON.stringify(e)), value: events };
    });
  }
}
