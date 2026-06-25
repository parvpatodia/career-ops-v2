/**
 * The --auto auto-detect path marks a job Applied via ApplicationStore.update
 * (which appends a `submitted` event), then persists the OBSERVED ATS
 * confirmation as a `confirmed` event via SubmissionRecorder.recordConfirmation.
 * These tests pin that exact sequence: confirmed lands after submitted, and a
 * confirmed with NO prior submitted is rejected by the projection guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ApplicationStore } from '../../src/tracker/ApplicationStore.js';
import { SubmissionRecorder } from '../../src/applier/SubmissionRecorder.js';
import { appIdFor } from '../../src/store/events.js';
import type { Application } from '../../src/types.js';

let dir: string;
let store: ApplicationStore;

function app(id: string, company: string): Application {
  return {
    id, jobId: `job-${id}`, date: '2026-06-25', company, role: 'ML Intern',
    score: 80, url: `https://example.com/${id}`, status: 'Ready',
    resumeVariant: 'ai', notes: '',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoconf-'));
  store = new ApplicationStore(path.join(dir, 'applications.json'), path.join(dir, 'applications.md'));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('auto-detect confirmation persistence', () => {
  it('records a confirmed event after the Applied (submitted) status update', () => {
    store.add(app('001', 'PlusAI'));
    store.update('001', { status: 'Applied', appliedAt: '2026-06-25T12:00:00Z' });

    const appId = appIdFor('PlusAI', 'ML Intern');
    const proj = store.eventStore().projection();
    expect(proj.isSubmitted(appId)).toBe(true);
    expect(proj.isConfirmed(appId)).toBe(false);

    new SubmissionRecorder(store.eventStore(), path.join(dir, 'receipts')).recordConfirmation(
      appId, `auto-${appId}-1`, 'Application submitted #GH-42'
    );

    expect(store.eventStore().projection().isConfirmed(appId)).toBe(true);
  });

  it('rejects a confirmed with no prior submitted (projection guard holds)', () => {
    store.add(app('002', 'Foo'));
    const appId = appIdFor('Foo', 'ML Intern');
    const rec = new SubmissionRecorder(store.eventStore(), path.join(dir, 'receipts'));
    expect(() => rec.recordConfirmation(appId, 'c-1', 'x')).toThrow();
    expect(store.eventStore().projection().isConfirmed(appId)).toBe(false);
  });
});
