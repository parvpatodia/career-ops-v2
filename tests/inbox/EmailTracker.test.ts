/**
 * EmailTracker: reconcile application status from inbox evidence. Fake email
 * fetch (no IMAP), real temp ApplicationStore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EmailTracker } from '../../src/inbox/EmailTracker.js';
import type { FetchHeaders } from '../../src/inbox/EmailTracker.js';
import type { EmailHeader } from '../../src/inbox/EmailMatcher.js';
import { ApplicationStore } from '../../src/tracker/ApplicationStore.js';
import type { Application } from '../../src/types.js';

let dir: string;
let store: ApplicationStore;

function makeApp(over: Partial<Application>): Application {
  return {
    id: '001', jobId: 'j1', date: '2026-06-16', company: 'Globex', role: 'ML Intern', score: 80,
    url: 'https://x', status: 'Ready', resumeVariant: 'ml', notes: 'greenhouse | Remote', ...over,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
  store = new ApplicationStore(path.join(dir, 'applications.json'), path.join(dir, 'applications.md'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const fetchOf = (emails: EmailHeader[]): FetchHeaders => async () => emails;

describe('EmailTracker', () => {
  it('marks an application Applied from a confirmation email (ground-truth)', async () => {
    store.add(makeApp({ id: '001', company: 'Scale AI', role: 'AI Builder Intern' }));
    const emails: EmailHeader[] = [
      { from: 'jobs@scaleai.com', subject: 'Thank you for applying to Scale AI', date: '2026-06-16T10:00:00Z', account: 'gmail' },
    ];
    const summary = await new EmailTracker(store, fetchOf(emails)).run([{ account: 'gmail', host: 'h', user: 'u', password: 'p' }]);

    expect(summary.updates).toHaveLength(1);
    expect(summary.updates[0]).toMatchObject({ company: 'Scale AI', to: 'Applied' });
    expect(store.getById('001')?.status).toBe('Applied');
  });

  it('marks Rejected / Interview from those emails', async () => {
    store.add(makeApp({ id: '001', company: 'Workato', role: 'Analytics Intern' }));
    store.add(makeApp({ id: '002', company: 'Tenstorrent', role: 'Kernel Intern' }));
    const emails: EmailHeader[] = [
      { from: 'no-reply@greenhouse.io', subject: 'Workato: unfortunately we are not moving forward', date: '2026-06-16T10:00:00Z', account: 'gmail' },
      { from: 'careers@tenstorrent.com', subject: 'Tenstorrent: we would like to schedule a call', date: '2026-06-16T11:00:00Z', account: 'gmail' },
    ];
    const summary = await new EmailTracker(store, fetchOf(emails)).run([{ account: 'gmail', host: 'h', user: 'u', password: 'p' }]);

    expect(store.getById('001')?.status).toBe('Rejected');
    expect(store.getById('002')?.status).toBe('Interview');
    expect(summary.matched).toBe(2);
  });

  it('does not reopen a terminal (Closed) application + is idempotent', async () => {
    store.add(makeApp({ id: '001', company: 'OldCo', role: 'ML Intern' }));
    store.update('001', { status: 'Closed' });
    const emails: EmailHeader[] = [
      { from: 'no-reply@greenhouse.io', subject: 'Thanks for applying to OldCo', date: '2026-06-16T10:00:00Z', account: 'gmail' },
    ];
    const tracker = new EmailTracker(store, fetchOf(emails));
    const acct = [{ account: 'gmail', host: 'h', user: 'u', password: 'p' }];

    const first = await tracker.run(acct);
    expect(first.updates).toHaveLength(0); // Closed is terminal, not reopened
    expect(store.getById('001')?.status).toBe('Closed');
  });

  it('continues when one account fails (per-account isolation)', async () => {
    store.add(makeApp({ id: '001', company: 'Scale AI', role: 'AI Builder Intern' }));
    const fetch: FetchHeaders = async (acct) => {
      if (acct.account === 'outlook') throw new Error('auth failed');
      return [{ from: 'x', subject: 'Thank you for applying to Scale AI', date: '2026-06-16T10:00:00Z', account: 'gmail' }];
    };
    const summary = await new EmailTracker(store, fetch).run([
      { account: 'gmail', host: 'h', user: 'u', password: 'p' },
      { account: 'outlook', host: 'h', user: 'u', password: 'p' },
    ]);
    expect(summary.updates).toHaveLength(1); // gmail still processed
    expect(store.getById('001')?.status).toBe('Applied');
  });
});
