/**
 * Dashboard API: views over the event log; the approve route only
 * accepts Ready ids and writes the consent artifact atomically.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import type { AddressInfo } from 'net';
import { createDashboardServer } from '../../src/dashboard/server.js';
import { ApplicationStore } from '../../src/tracker/ApplicationStore.js';
import type { Application } from '../../src/types.js';

let dir: string;
let server: http.Server;
let base: string;

function app(id: string, company: string, status: Application['status']): Application {
  return {
    id,
    jobId: `job-${id}`,
    date: new Date().toISOString().split('T')[0]!,
    company,
    role: 'ML Intern',
    score: 80,
    url: `https://example.com/${id}`,
    status,
    resumeVariant: 'ai',
    notes: '',
  };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-'));
  const store = new ApplicationStore(path.join(dir, 'applications.json'), path.join(dir, 'applications.md'));
  store.add(app('001', 'ReadyCo', 'Ready'));
  store.add(app('002', 'AppliedCo', 'Applied'));

  server = createDashboardServer({
    eventsPath: path.join(dir, 'events.jsonl'),
    approvalsPath: path.join(dir, 'approvals.json'),
    receiptsDir: path.join(dir, 'receipts'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('dashboard server', () => {
  it('serves the queue grouped by status with counts', async () => {
    const q = await (await fetch(`${base}/api/queue`)).json();
    expect(q.ready.map((a: { id: string }) => a.id)).toEqual(['001']);
    expect(q.applied.map((a: { id: string }) => a.id)).toEqual(['002']);
    expect(q.counts).toEqual({ Ready: 1, Applied: 1 });
    expect(q.ready[0].ageDays).toBe(0);
  });

  it('approve accepts only Ready ids and persists the batch', async () => {
    const r = await (
      await fetch(`${base}/api/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['001', '002', '999'] }),
      })
    ).json();

    expect(r.approved).toEqual(['001']);
    expect(r.rejected).toEqual(['002', '999']);

    const file = JSON.parse(fs.readFileSync(path.join(dir, 'approvals.json'), 'utf8'));
    expect(file.batches).toHaveLength(1);
    expect(file.batches[0].ids).toEqual(['001']);
    expect(Date.parse(file.batches[0].approvedAt)).toBeGreaterThan(0);
  });

  it('rejects a malformed approve payload', async () => {
    const res = await fetch(`${base}/api/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });

  it('serves empty flags and receipts gracefully', async () => {
    expect(await (await fetch(`${base}/api/flags`)).json()).toEqual([]);
    expect(await (await fetch(`${base}/api/receipts`)).json()).toEqual([]);
  });

  it('serves the HTML page', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('career-ops control panel');
  });
});
