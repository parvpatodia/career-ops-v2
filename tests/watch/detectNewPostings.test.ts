import { describe, it, expect } from 'vitest';
import { detectNewPostings } from '../../src/watch/detectNewPostings.js';
import type { Job } from '../../src/types.js';

function job(id: string, title = 'ML Intern'): Job {
  return {
    id, title, company: 'Acme', url: `https://x/${id}`, applyUrl: `https://x/${id}`,
    platform: 'greenhouse', location: 'Remote', remote: true,
    postedAt: '2026-06-25', discoveredAt: '2026-06-25', jd: 'x', status: 'discovered',
  };
}

describe('detectNewPostings', () => {
  it('seeds silently on the first run (never alerts on the whole existing board)', () => {
    const r = detectNewPostings([job('a'), job('b')], []);
    expect(r.firstRun).toBe(true);
    expect(r.fresh).toEqual([]);
    expect(new Set(r.nextSeen)).toEqual(new Set(['a', 'b']));
  });

  it('alerts only on postings that appeared after we started watching', () => {
    const r = detectNewPostings([job('a'), job('b'), job('c')], ['a', 'b']);
    expect(r.firstRun).toBe(false);
    expect(r.fresh.map((j) => j.id)).toEqual(['c']);
    expect(new Set(r.nextSeen)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('emits nothing when every posting is already seen', () => {
    const r = detectNewPostings([job('a'), job('b')], ['a', 'b']);
    expect(r.fresh).toEqual([]);
  });

  it('de-dups a new posting surfaced by two sources into a single alert', () => {
    const r = detectNewPostings([job('a'), job('c'), job('c')], ['a']);
    expect(r.fresh.map((j) => j.id)).toEqual(['c']);
  });

  it('carries previously-seen ids that are no longer on the board (never re-alerts them)', () => {
    // 'b' fell off the board this cycle; it must stay in nextSeen so if it
    // reappears we do not alert on it as "new".
    const r = detectNewPostings([job('a')], ['a', 'b']);
    expect(r.fresh).toEqual([]);
    expect(new Set(r.nextSeen)).toEqual(new Set(['a', 'b']));
  });
});
