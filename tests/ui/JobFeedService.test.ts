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

  it('fresh() attaches real posting freshness for board roles, null for email/unknown', () => {
    const now = Date.now();
    const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
    const caught = new Date(now).toISOString();
    const hot = path.join(dir, 'new-jobs.json');
    fs.writeFileSync(hot, JSON.stringify([
      { id: 'a', company: 'A', role: 'ML Intern', applyUrl: 'https://x/a', platform: 'greenhouse', postedAt: iso(1), caughtAt: caught },
      { id: 'b', company: 'B', role: 'ML Intern', applyUrl: 'https://x/b', platform: 'ashby', postedAt: iso(12), caughtAt: caught },   // expiring soon
      { id: 'c', company: 'C', role: 'ML Intern', applyUrl: 'https://x/c', platform: 'email:scalar', postedAt: iso(1), caughtAt: caught }, // proxy date -> null
      { id: 'd', company: 'D', role: 'ML Intern', applyUrl: 'https://x/d', platform: 'lever', postedAt: '', caughtAt: caught },           // unparseable -> null
    ]));
    const byId = new Map(new JobFeedService(store, hot).snapshot().fresh.map((f) => [f.id, f.freshness]));
    expect(byId.get('a')).toEqual({ postedAgeDays: 1, expiresInDays: 13 });
    expect(byId.get('b')).toEqual({ postedAgeDays: 12, expiresInDays: 2 }); // <= 4: UI flags it
    expect(byId.get('c')).toBeNull();
    expect(byId.get('d')).toBeNull();
  });

  it('fresh() attaches tailored-doc flags from the manifest (verified résumé only)', () => {
    const now = new Date().toISOString();
    const hot = path.join(dir, 'new-jobs.json');
    fs.writeFileSync(hot, JSON.stringify([
      { id: 'a', company: 'A', role: 'ML Intern', applyUrl: 'https://x/a', platform: 'greenhouse', postedAt: '', caughtAt: now },
      { id: 'b', company: 'B', role: 'ML Intern', applyUrl: 'https://x/b', platform: 'greenhouse', postedAt: '', caughtAt: now },
      { id: 'c', company: 'C', role: 'ML Intern', applyUrl: 'https://x/c', platform: 'greenhouse', postedAt: '', caughtAt: now },
    ]));
    const manifest = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({
      a: { verified: true, resumePath: 'output/tailored/a-ml.pdf', coverLetterPdfPath: 'output/tailored/cover_letters/a.pdf' },
      b: { verified: false, resumePath: 'output/tailored/b-ml.pdf' }, // résumé abstained -> not offered
      // c: no entry -> no tailored field
    }));
    const byId = new Map(new JobFeedService(store, hot, manifest).snapshot().fresh.map((f) => [f.id, f.tailored]));
    expect(byId.get('a')).toEqual({ resume: true, cover: true });
    expect(byId.get('b')).toBeUndefined(); // unverified résumé + no cover -> nothing to offer
    expect(byId.get('c')).toBeUndefined();
  });

  it('fresh() attaches a human-readable sourceLabel', () => {
    const now = new Date().toISOString();
    const hot = path.join(dir, 'new-jobs.json');
    fs.writeFileSync(hot, JSON.stringify([
      { id: '1', company: 'X', role: 'ML Intern', applyUrl: 'https://x/1', platform: 'email:swelist', postedAt: '', caughtAt: now },
      { id: '2', company: 'Y', role: 'ML Intern', applyUrl: 'https://x/2', platform: 'greenhouse', postedAt: '', caughtAt: now },
    ]));
    const byId = new Map(new JobFeedService(store, hot).snapshot().fresh.map((f) => [f.id, f.sourceLabel]));
    expect(byId.get('1')).toBe('SWE List email');
    expect(byId.get('2')).toBe('Greenhouse');
  });

  it('fresh() blanks a known-wrong company label but keeps the role', () => {
    const now = new Date().toISOString();
    const hot = path.join(dir, 'new-jobs.json');
    fs.writeFileSync(hot, JSON.stringify([
      { id: '1', company: 'Fall 2026', role: 'Machine Learning Intern', applyUrl: 'https://x/1', platform: 'email:jobright', postedAt: '', caughtAt: now },
      { id: '2', company: 'Anthropic', role: 'ML Intern', applyUrl: 'https://x/2', platform: 'greenhouse', postedAt: '', caughtAt: now },
    ]));
    const byId = new Map(new JobFeedService(store, hot).snapshot().fresh.map((f) => [f.id, f.company]));
    expect(byId.get('1')).toBe(''); // term-label company blanked, role still present
    expect(byId.get('2')).toBe('Anthropic');
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
