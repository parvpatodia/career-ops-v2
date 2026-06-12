/**
 * Test group 5 (SPEC M1): legacy migration preserves every record, every
 * status, every legacy id. The real tracker has 370 records; this fixture
 * covers one record per lifecycle stage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventStore } from '../../src/store/EventStore.js';
import { appIdFor } from '../../src/store/events.js';
import { migrateLegacy } from '../../scripts/migrate-legacy.js';
import type { Application, ApplicationStatus } from '../../src/types.js';

function legacy(id: string, company: string, role: string, status: ApplicationStatus): Application {
  return {
    id,
    jobId: `job-${id}`,
    date: '2026-05-03',
    company,
    role,
    score: 72,
    url: `https://example.com/${id}`,
    status,
    resumeVariant: 'ml',
    notes: 'platform | location',
  };
}

const FIXTURE: Application[] = [
  legacy('001', 'Alpha', 'MLE Intern', 'Ready'),
  legacy('002', 'Beta', 'SWE Intern', 'Applied'),
  legacy('003', 'Gamma', 'AI Intern', 'Interview'),
  legacy('004', 'Delta', 'Robotics Intern', 'Closed'),
  legacy('005', 'Epsilon', 'Data Intern', 'SKIP'),
  legacy('006', 'Zeta', 'Vision Intern', 'Rejected'),
];

let dir: string;
let eventsFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'));
  eventsFile = path.join(dir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('migrateLegacy', () => {
  it('emits every record and preserves exact status counts', () => {
    const store = new EventStore(eventsFile);
    const result = migrateLegacy(FIXTURE, store);
    expect(result.migrated).toBe(6);

    const proj = store.projection();
    const apps = proj.all();
    expect(apps).toHaveLength(6);

    const counts: Record<string, number> = {};
    for (const a of apps) counts[a.status] = (counts[a.status] ?? 0) + 1;
    expect(counts).toEqual({ Ready: 1, Applied: 1, Interview: 1, Closed: 1, SKIP: 1, Rejected: 1 });
  });

  it('preserves legacy ids and produces unique appIds', () => {
    const store = new EventStore(eventsFile);
    migrateLegacy(FIXTURE, store);
    const proj = store.projection();

    expect(proj.getByLegacyId('003')?.company).toBe('Gamma');
    const appIds = proj.all().map((a) => appIdFor(a.company, a.role));
    expect(new Set(appIds).size).toBe(6);
  });

  it('marks applied-stage records as submitted so the double-submit guard holds', () => {
    const store = new EventStore(eventsFile);
    migrateLegacy(FIXTURE, store);
    const proj = store.projection();

    expect(proj.isSubmitted(appIdFor('Beta', 'SWE Intern'))).toBe(true);
    expect(proj.isSubmitted(appIdFor('Gamma', 'AI Intern'))).toBe(true);
    expect(proj.isSubmitted(appIdFor('Alpha', 'MLE Intern'))).toBe(false);
  });

  it('tags every emitted event as legacy', () => {
    const store = new EventStore(eventsFile);
    migrateLegacy(FIXTURE, store);
    const { events } = store.readAll();
    expect(events.length).toBeGreaterThanOrEqual(6);
    expect(events.every((e) => e.payload.legacy === true)).toBe(true);
  });

  it('is idempotent: running twice does not duplicate records', () => {
    const store = new EventStore(eventsFile);
    migrateLegacy(FIXTURE, store);
    const second = migrateLegacy(FIXTURE, store);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(6);
    expect(store.projection().all()).toHaveLength(6);
  });
});
