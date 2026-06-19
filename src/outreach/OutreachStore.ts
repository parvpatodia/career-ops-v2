/**
 * Single write path for outreach state, built on the shared JsonlLog (the same
 * append-only + single-writer-lock + incremental-cache machinery as the job
 * EventStore). Owns the outreach meaning: seq numbering and the
 * OutreachProjection transition guard. Default log: data/outreach.jsonl.
 *
 * Side-effecting class: the path is injectable so tests write to a temp dir and
 * never touch the real log (LESSONS 2026-06-12).
 */

import { JsonlLog } from '../store/JsonlLog.js';
import { OutreachProjection } from './OutreachProjection.js';
import {
  OUTREACH_EVENT_TYPES,
  isValidContactId,
  validateOutreachEvent,
} from './events.js';
import type { OutreachEvent, OutreachEventType } from './events.js';

export class OutreachTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutreachTransitionError';
  }
}

export interface OutreachAppendInput {
  type: OutreachEventType;
  contactId: string;
  payload?: Record<string, unknown>;
}

export class OutreachStore {
  private readonly log: JsonlLog<OutreachEvent>;

  constructor(filePath = 'data/outreach.jsonl') {
    this.log = new JsonlLog<OutreachEvent>(filePath, validateOutreachEvent);
  }

  readAll(): { events: OutreachEvent[]; corruptLines: number } {
    const { records, corruptLines } = this.log.read();
    return { events: records, corruptLines };
  }

  projection(): OutreachProjection {
    const proj = new OutreachProjection();
    for (const e of this.log.read().records) proj.apply(e);
    return proj;
  }

  /** Convenience over projection() for the common de-dup check. */
  isSuppressed(contactId: string): boolean {
    return this.projection().isSuppressed(contactId);
  }

  append(input: OutreachAppendInput): OutreachEvent {
    return this.appendGroup([input])[0]!;
  }

  /** append() that reports an expected rejection as a value instead of throwing. */
  tryAppend(
    input: OutreachAppendInput
  ): { ok: true; event: OutreachEvent } | { ok: false; reason: string } {
    try {
      return { ok: true, event: this.append(input) };
    } catch (err) {
      if (err instanceof OutreachTransitionError) return { ok: false, reason: err.message };
      throw err;
    }
  }

  /**
   * All-or-nothing append of correlated events under one lock. WHY a group: a
   * send receipt is email_sent plus a status note that must never half-land,
   * the same reason the job log has appendGroup.
   */
  appendGroup(inputs: OutreachAppendInput[], cid?: string): OutreachEvent[] {
    if (inputs.length === 0) throw new Error('appendGroup: empty group');
    for (const input of inputs) {
      if (!(OUTREACH_EVENT_TYPES as readonly string[]).includes(input.type)) {
        throw new Error(`Unknown outreach event type: ${input.type}`);
      }
      if (!isValidContactId(input.contactId)) {
        throw new Error(`Invalid contactId (want 12 hex chars): ${input.contactId}`);
      }
    }

    return this.log.append((records) => {
      const proj = new OutreachProjection();
      for (const e of records) proj.apply(e);

      let seq = records[records.length - 1]?.seq ?? 0;
      const ts = new Date().toISOString();
      const events: OutreachEvent[] = [];
      for (const input of inputs) {
        const event: OutreachEvent = {
          seq: ++seq,
          ts,
          type: input.type,
          contactId: input.contactId,
          payload: input.payload ?? {},
          ...(cid !== undefined ? { cid } : {}),
        };
        const verdict = proj.canApply(event);
        if (!verdict.ok) throw new OutreachTransitionError(verdict.reason);
        proj.apply(event);
        events.push(event);
      }

      return { lines: events.map((e) => JSON.stringify(e)), value: events };
    });
  }
}
