/**
 * Test group 1 (SPEC M1): the v1-killer regression.
 * v1 wiped the whole tracker when one JSON parse failed (LESSONS.md
 * 2026-06-10). The event log must: skip a corrupt line, keep every other
 * event, keep accepting appends, and never rewrite existing bytes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventStore } from '../../src/store/EventStore.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventstore-'));
  file = path.join(dir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('EventStore corrupt-line recovery', () => {
  it('skips a corrupt line and keeps all valid events', () => {
    const store = new EventStore(file);
    store.append({ type: 'discovered', appId: 'aaaaaaaaaaaa', payload: { company: 'A', role: 'x' } });
    store.append({ type: 'discovered', appId: 'bbbbbbbbbbbb', payload: { company: 'B', role: 'y' } });

    // Simulate a crash mid-write / disk corruption between two valid events.
    fs.appendFileSync(file, '{"seq": 3, "ts": "2026-06-1\n');
    const store2 = new EventStore(file);
    store2.append({ type: 'discovered', appId: 'cccccccccccc', payload: { company: 'C', role: 'z' } });

    const result = store2.readAll();
    expect(result.events).toHaveLength(3);
    expect(result.corruptLines).toBe(1);
    expect(result.events.map((e) => e.appId)).toEqual([
      'aaaaaaaaaaaa',
      'bbbbbbbbbbbb',
      'cccccccccccc',
    ]);
  });

  it('never rewrites existing bytes: the corrupt line is still on disk', () => {
    const store = new EventStore(file);
    store.append({ type: 'discovered', appId: 'aaaaaaaaaaaa', payload: {} });
    fs.appendFileSync(file, 'TOTAL GARBAGE NOT JSON\n');
    store.append({ type: 'discovered', appId: 'bbbbbbbbbbbb', payload: {} });

    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).toContain('TOTAL GARBAGE NOT JSON');
    expect(raw.trim().split('\n')).toHaveLength(3);
  });

  it('a structurally valid JSON line with a wrong shape counts as corrupt', () => {
    const store = new EventStore(file);
    store.append({ type: 'discovered', appId: 'aaaaaaaaaaaa', payload: {} });
    fs.appendFileSync(file, JSON.stringify({ hello: 'world' }) + '\n');

    const result = store.readAll();
    expect(result.events).toHaveLength(1);
    expect(result.corruptLines).toBe(1);
  });

  it('missing file means zero events, not an error', () => {
    const store = new EventStore(file);
    const result = store.readAll();
    expect(result.events).toHaveLength(0);
    expect(result.corruptLines).toBe(0);
  });
});
