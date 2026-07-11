import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ApplicationStore } from '../../src/tracker/ApplicationStore.js';
import { JobFeedService } from '../../src/ui/JobFeedService.js';
import type { Application } from '../../src/types.js';

let dir: string;
let store: ApplicationStore;

function app(id: string, company: string, score = 80): Application {
  return {
    id, jobId: `job-${id}`, date: '2026-07-11', company, role: 'ML Engineer Intern',
    score, url: `https://x/${id}`, status: 'Ready', resumeVariant: 'ml', notes: '',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-'));
  store = new ApplicationStore(path.join(dir, 'applications.json'), path.join(dir, 'applications.md'));
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('JobFeedService', () => {
  it('composes fresh hot-list + queue counts + Ready list (sorted by score desc)', () => {
    store.add(app('001', 'Cohere', 70));
    store.add(app('002', 'Waymo', 91));
    store.update('002', { status: 'Applied', appliedAt: '2026-07-11T12:00:00Z' });

    const hot = path.join(dir, 'new-jobs.json');
    fs.writeFileSync(hot, JSON.stringify([
      { id: 'gh-1', company: 'Perplexity', role: 'ML Intern', applyUrl: 'https://p/1', platform: 'ashby', postedAt: '2026-07-11', caughtAt: '2026-07-11T13:00:00Z' },
      { id: 'gh-2', company: 'Figure', role: 'Robotics Intern', applyUrl: 'https://f/2', platform: 'greenhouse', postedAt: '2026-07-11', caughtAt: '2026-07-11T13:01:00Z' },
    ]));

    const snap = new JobFeedService(store, hot).snapshot();
    expect(snap.fresh.map((f) => f.company)).toEqual(['Perplexity', 'Figure']);
    expect(snap.counts.Ready).toBe(1);   // 001 only (002 moved to Applied)
    expect(snap.counts.Applied).toBe(1); // 002
    expect(snap.ready.map((r) => r.id)).toEqual(['001']);
  });

  it('returns an empty fresh list (no crash) when the hot-list file is absent', () => {
    const snap = new JobFeedService(store, path.join(dir, 'does-not-exist.json')).snapshot();
    expect(snap.fresh).toEqual([]);
  });
});
