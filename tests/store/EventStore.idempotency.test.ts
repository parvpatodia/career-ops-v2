/**
 * Test group 2 (SPEC M1): the double-submit guard.
 * One application per company+role, ever (AGENTS.md invariant 3). A second
 * `submitted` event for the same appId must be rejected at append time.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventstore-'));
  file = path.join(dir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('EventStore idempotency guard', () => {
  it('rejects a second submitted event for the same appId', () => {
    const store = new EventStore(file);
    const appId = appIdFor('OpenAI', 'ML Engineer Intern');
    store.append({ type: 'submitted', appId, payload: {} });
    expect(() => store.append({ type: 'submitted', appId, payload: {} })).toThrow(TransitionError);
  });

  it('rejection survives a process restart (state is on disk, not in memory)', () => {
    const appId = appIdFor('OpenAI', 'ML Engineer Intern');
    new EventStore(file).append({ type: 'submitted', appId, payload: {} });
    const fresh = new EventStore(file);
    expect(() => fresh.append({ type: 'submitted', appId, payload: {} })).toThrow(TransitionError);
  });

  it('allows submitted for a different appId', () => {
    const store = new EventStore(file);
    store.append({ type: 'submitted', appId: appIdFor('OpenAI', 'ML Intern'), payload: {} });
    expect(() =>
      store.append({ type: 'submitted', appId: appIdFor('Anthropic', 'ML Intern'), payload: {} })
    ).not.toThrow();
  });

  it('rejects confirmed before submitted', () => {
    const store = new EventStore(file);
    const appId = appIdFor('OpenAI', 'ML Intern');
    expect(() => store.append({ type: 'confirmed', appId, payload: {} })).toThrow(TransitionError);
    store.append({ type: 'submitted', appId, payload: {} });
    expect(() => store.append({ type: 'confirmed', appId, payload: {} })).not.toThrow();
  });

  it('appIdFor normalizes case and whitespace', () => {
    expect(appIdFor('OpenAI', 'ML  Engineer Intern')).toBe(appIdFor('openai ', 'ml engineer intern'));
    expect(appIdFor('OpenAI', 'a')).not.toBe(appIdFor('OpenAI', 'b'));
    expect(appIdFor('OpenAI', 'a')).toMatch(/^[0-9a-f]{12}$/);
  });
});
