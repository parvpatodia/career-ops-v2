/**
 * The stale-queue purge: only old Ready entries close; fresh Ready and
 * already-applied records are untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ApplicationStore } from '../../src/tracker/ApplicationStore.js';
import { expireStale } from '../../scripts/expire-stale.js';
import type { Application } from '../../src/types.js';

const NOW = new Date('2026-06-12T12:00:00Z').getTime();

let dir: string;
let store: ApplicationStore;

function app(id: string, company: string, date: string, status: Application['status']): Application {
  return {
    id,
    jobId: `job-${id}`,
    date,
    company,
    role: 'ML Intern',
    score: 70,
    url: `https://example.com/${id}`,
    status,
    resumeVariant: 'ai',
    notes: '',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expire-'));
  store = new ApplicationStore(path.join(dir, 'applications.json'), path.join(dir, 'applications.md'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('expireStale', () => {
  it('closes only Ready entries older than the window', () => {
    store.add(app('001', 'OldCo', '2026-05-01', 'Ready'));
    store.add(app('002', 'FreshCo', '2026-06-10', 'Ready'));
    store.add(app('003', 'AppliedCo', '2026-05-01', 'Applied'));

    const closed = expireStale(store, NOW, 14);

    expect(closed).toEqual(['001']);
    expect(store.getById('001')?.status).toBe('Closed');
    expect(store.getById('002')?.status).toBe('Ready');
    expect(store.getById('003')?.status).toBe('Applied');
  });

  it('treats an unparseable queue date as stale (unprovably fresh)', () => {
    store.add(app('001', 'MysteryCo', 'sometime in spring', 'Ready'));
    const closed = expireStale(store, NOW, 14);
    expect(closed).toEqual(['001']);
  });
});
