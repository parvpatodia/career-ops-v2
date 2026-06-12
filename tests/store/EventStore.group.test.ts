/**
 * M2 store extension (SPEC M2 step 1): correlated atomic groups, verdict
 * appends, and the incremental read cache.
 *
 * appendGroup exists because a receipt must never half-land around a
 * submit: either every event of the group is validated and written, or
 * none are.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventStore, TransitionError } from '../../src/store/EventStore.js';
import { appIdFor } from '../../src/store/events.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventstore-group-'));
  file = path.join(dir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('EventStore.appendGroup', () => {
  it('appends all events with the same correlation id and sequential seqs', () => {
    const store = new EventStore(file);
    const appId = appIdFor('OpenAI', 'MLE Intern');
    const group = store.appendGroup(
      [
        { type: 'fill_verified', appId, payload: { fields: 12 } },
        { type: 'submitted', appId, payload: {} },
        { type: 'note', appId, payload: { patch: { notes: 'receipt-after' } } },
      ],
      'receipt-001'
    );

    expect(group).toHaveLength(3);
    expect(group.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(group.every((e) => e.cid === 'receipt-001')).toBe(true);

    const { events } = store.readAll();
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.cid === 'receipt-001')).toBe(true);
  });

  it('an invalid transition mid-group aborts the whole group: zero events land', () => {
    const store = new EventStore(file);
    const appId = appIdFor('OpenAI', 'MLE Intern');
    store.append({ type: 'submitted', appId, payload: {} });

    expect(() =>
      store.appendGroup(
        [
          { type: 'note', appId, payload: { patch: { notes: 'x' } } },
          { type: 'submitted', appId, payload: {} }, // duplicate: must reject
        ],
        'receipt-002'
      )
    ).toThrow(TransitionError);

    const { events } = store.readAll();
    expect(events).toHaveLength(1); // only the original submitted
    expect(events[0]!.cid).toBeUndefined();
  });

  it('validates later group events against earlier ones (rolling projection)', () => {
    const store = new EventStore(file);
    const appId = appIdFor('OpenAI', 'MLE Intern');
    // confirmed is only legal after submitted; both arrive in one group.
    const group = store.appendGroup(
      [
        { type: 'submitted', appId, payload: {} },
        { type: 'confirmed', appId, payload: { confirmationId: 'gh-123' } },
      ],
      'receipt-003'
    );
    expect(group).toHaveLength(2);
    expect(store.projection().isConfirmed(appId)).toBe(true);
  });

  it('rejects an empty group', () => {
    const store = new EventStore(file);
    expect(() => store.appendGroup([], 'receipt-004')).toThrow(/empty/i);
  });
});

describe('EventStore.tryAppend', () => {
  it('returns ok:false with a reason instead of throwing on duplicate submitted', () => {
    const store = new EventStore(file);
    const appId = appIdFor('OpenAI', 'MLE Intern');
    store.append({ type: 'submitted', appId, payload: {} });

    const verdict = store.tryAppend({ type: 'submitted', appId, payload: {} });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/duplicate submitted/);
    expect(store.readAll().events).toHaveLength(1);
  });

  it('returns ok:true with the event on success', () => {
    const store = new EventStore(file);
    const appId = appIdFor('OpenAI', 'MLE Intern');
    const verdict = store.tryAppend({ type: 'discovered', appId, payload: {} });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.event.seq).toBe(1);
  });
});

describe('EventStore incremental cache', () => {
  it('one instance sees events appended by another instance (external growth)', () => {
    const a = new EventStore(file);
    const b = new EventStore(file);
    a.append({ type: 'discovered', appId: 'aaaaaaaaaaaa', payload: {} });
    expect(a.readAll().events).toHaveLength(1);

    b.append({ type: 'discovered', appId: 'bbbbbbbbbbbb', payload: {} });
    b.append({ type: 'discovered', appId: 'cccccccccccc', payload: {} });

    const seen = a.readAll();
    expect(seen.events).toHaveLength(3);
    expect(seen.events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('a partial trailing line (no newline) is not consumed until completed', () => {
    const store = new EventStore(file);
    store.append({ type: 'discovered', appId: 'aaaaaaaaaaaa', payload: {} });
    fs.appendFileSync(file, '{"seq": 99, "ts": "2026'); // crash mid-write, no newline

    const first = store.readAll();
    expect(first.events).toHaveLength(1);

    // Our next append quarantines the partial line with a leading newline.
    store.append({ type: 'discovered', appId: 'bbbbbbbbbbbb', payload: {} });
    const second = store.readAll();
    expect(second.events).toHaveLength(2);
    expect(second.corruptLines).toBe(1);
  });

  it('repeated reads do not re-parse: results stay correct and snapshot-independent', () => {
    const store = new EventStore(file);
    const appId = appIdFor('OpenAI', 'MLE Intern');
    store.append({ type: 'discovered', appId, payload: {} });

    const projBefore = store.projection();
    store.append({ type: 'submitted', appId, payload: {} });
    const projAfter = store.projection();

    // Snapshot semantics: an earlier projection must not mutate when new
    // events arrive (each projection() call folds fresh).
    expect(projBefore.isSubmitted(appId)).toBe(false);
    expect(projAfter.isSubmitted(appId)).toBe(true);
  });
});
