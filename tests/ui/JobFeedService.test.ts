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
    // Applied section: the moved-to-Applied role, with its applied timestamp.
    expect(snap.applied.map((a) => a.company)).toEqual(['Waymo']);
    expect(snap.applied[0]!.appliedAt).toBe('2026-07-11T12:00:00Z');
  });

  it('sorts Applied most-recently-applied first', () => {
    store.add(app('001', 'Older'));
    store.update('001', { status: 'Applied', appliedAt: '2026-07-10T09:00:00Z' });
    store.add(app('002', 'Newer'));
    store.update('002', { status: 'Applied', appliedAt: '2026-07-12T09:00:00Z' });
    const snap = new JobFeedService(store, path.join(dir, 'none.json')).snapshot();
    expect(snap.applied.map((a) => a.company)).toEqual(['Newer', 'Older']);
  });

  it('returns an empty fresh list (no crash) when the hot-list file is absent', () => {
    const snap = new JobFeedService(store, path.join(dir, 'does-not-exist.json')).snapshot();
    expect(snap.fresh).toEqual([]);
  });

  it('fresh() drops off-field / non-US / ineligible roles at the read boundary', () => {
    const now = new Date().toISOString();
    const hot = path.join(dir, 'new-jobs.json');
    const e = (id: string, role: string, location: string) => ({
      id, company: 'Co' + id, role, applyUrl: 'https://x/' + id, platform: 'greenhouse', postedAt: '', caughtAt: now, location,
    });
    fs.writeFileSync(hot, JSON.stringify([
      e('1', 'Machine Learning Intern', 'San Francisco, CA'),          // keep
      e('2', 'Partner Solutions Intern', 'New York, NY'),              // off-field -> drop
      e('3', 'Robotics Intern', 'Montreal, QC, Canada'),               // non-US -> drop
      e('4', 'ML Intern (active security clearance required)', 'VA'),  // ineligible -> drop
      e('5', 'Software Engineer Intern', 'Austin, TX'),                // keep
    ]));
    const snap = new JobFeedService(store, hot).snapshot();
    expect(snap.fresh.map((f) => f.id).sort()).toEqual(['1', '5']);
  });

  it('fresh() recomputes category from the role (fixes older un-tagged entries)', () => {
    const now = new Date().toISOString();
    const hot = path.join(dir, 'new-jobs.json');
    fs.writeFileSync(hot, JSON.stringify([
      // no category stored (older entry) — must be recomputed, not shown as Other
      { id: '1', company: 'X', role: 'Software Engineer New Grad', applyUrl: 'https://x/1', platform: 'newgrad', postedAt: '', caughtAt: now },
      // stale/wrong stored category — must be overridden by the role
      { id: '2', company: 'Y', role: 'Machine Learning Intern', applyUrl: 'https://x/2', platform: 'gh', postedAt: '', caughtAt: now, category: 'Other' },
    ]));
    const byId = new Map(new JobFeedService(store, hot).snapshot().fresh.map((f) => [f.id, f.category]));
    expect(byId.get('1')).toBe('Software');
    expect(byId.get('2')).toBe('AI/ML');
  });
});
