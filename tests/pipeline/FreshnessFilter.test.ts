/**
 * Parv's rule (2026-06-12): no application to postings older than 14 days,
 * no exceptions, and a date the system cannot parse is NOT fresh. The old
 * filter had a 60-day big-company exception (removed) and dropped
 * unparseable dates into `stale` silently (now an explicit bucket).
 */

import { describe, it, expect } from 'vitest';
import { FreshnessFilter } from '../../src/pipeline/FreshnessFilter.js';
import type { Job } from '../../src/types.js';

const NOW = new Date('2026-06-12T12:00:00Z').getTime();

function job(id: string, company: string, postedAt: string): Job {
  return {
    id,
    title: 'ML Intern',
    company,
    url: `https://example.com/${id}`,
    platform: 'direct',
    location: 'San Jose, CA',
    remote: false,
    postedAt,
    discoveredAt: '2026-06-12',
    jd: 'x',
    status: 'discovered',
  };
}

describe('FreshnessFilter (hard 14-day rule)', () => {
  const filter = new FreshnessFilter();

  it('keeps a posting from today and from 13 days ago', () => {
    const { fresh } = filter.filter(
      [job('a', 'SmallCo', '2026-06-12'), job('b', 'SmallCo', '2026-05-30')],
      NOW
    );
    expect(fresh.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('rejects a posting 15 days old', () => {
    const { fresh, stale } = filter.filter([job('a', 'SmallCo', '2026-05-28')], NOW);
    expect(fresh).toHaveLength(0);
    expect(stale.map((j) => j.id)).toEqual(['a']);
  });

  it('regression: big companies get NO exception anymore', () => {
    const { fresh, stale } = filter.filter(
      [job('a', 'Google', '2026-05-10'), job('b', 'OpenAI', '2026-05-01')],
      NOW
    );
    expect(fresh).toHaveLength(0);
    expect(stale).toHaveLength(2);
  });

  it('an unparseable or missing date is unknown, never fresh', () => {
    const { fresh, stale, unknown } = filter.filter(
      [job('a', 'SmallCo', 'Posted recently'), job('b', 'SmallCo', '')],
      NOW
    );
    expect(fresh).toHaveLength(0);
    expect(stale).toHaveLength(0);
    expect(unknown.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('supports a tighter window (past week)', () => {
    const sevenDay = new FreshnessFilter(7);
    const { fresh, stale } = sevenDay.filter(
      [job('a', 'SmallCo', '2026-06-08'), job('b', 'SmallCo', '2026-06-01')],
      NOW
    );
    expect(fresh.map((j) => j.id)).toEqual(['a']);
    expect(stale.map((j) => j.id)).toEqual(['b']);
  });
});
