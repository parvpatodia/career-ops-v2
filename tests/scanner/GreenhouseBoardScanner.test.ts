/**
 * GreenhouseBoardScanner against a faked boards API. The test that
 * matters most: a job with a fresh updated_at but an old first_published
 * must be EXCLUDED (the stale-laundering trap verified live 2026-06-12).
 */

import { describe, it, expect } from 'vitest';
import { GreenhouseBoardScanner, htmlToText } from '../../src/scanner/GreenhouseBoardScanner.js';
import type { FetchLike, GreenhouseBoardsConfig } from '../../src/scanner/GreenhouseBoardScanner.js';
import type { Job, ScanQuery } from '../../src/types.js';

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const CFG: GreenhouseBoardsConfig = {
  boards: ['acme', 'deadboard'],
  titleInclude: ['intern', 'co-op'],
  titleExclude: ['manager'],
};

const LIST = {
  jobs: [
    {
      id: 1,
      title: 'Software Engineer Intern',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1',
      company_name: 'Acme',
      first_published: daysAgo(3),
      updated_at: daysAgo(1),
      location: { name: 'San Jose, CA' },
    },
    {
      id: 2,
      title: 'Senior ML Engineer',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/2',
      company_name: 'Acme',
      first_published: daysAgo(2),
    },
    {
      id: 3,
      title: 'Machine Learning Intern',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/3',
      company_name: 'Acme',
      first_published: daysAgo(500), // the trap: updated yesterday, posted 2024
      updated_at: daysAgo(1),
    },
    {
      id: 4,
      title: 'Robotics Co-op',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/4',
      company_name: 'Acme',
      first_published: null, // unknown date: kept, reported by pipeline
      location: { name: 'Remote - US' },
    },
    {
      id: 5,
      title: 'Data Intern',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/5',
      company_name: 'Acme',
      first_published: daysAgo(1),
      application_deadline: daysAgo(1), // deadline passed yesterday
    },
    {
      id: 6,
      title: 'Intern Program Manager',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/6',
      company_name: 'Acme',
      first_published: daysAgo(1),
    },
  ],
};

const fakeFetch: FetchLike = async (url: string) => {
  if (url.includes('/deadboard/')) return { ok: false, status: 404, json: async () => ({}) };
  if (url.endsWith('/acme/jobs')) return { ok: true, status: 200, json: async () => LIST };
  // Detail endpoints: escaped-HTML content.
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: '&lt;p&gt;Build &amp;amp; ship robots&lt;/p&gt;' }),
  };
};

class Testable extends GreenhouseBoardScanner {
  scanPublic(q: ScanQuery): Promise<Job[]> {
    return this.scan(q);
  }
}

describe('GreenhouseBoardScanner', () => {
  const scanner = new Testable(CFG, fakeFetch);

  it('keeps fresh intern/co-op roles and excludes everything else for the right reasons', async () => {
    const jobs = await scanner.scanPublic({});
    const titles = jobs.map((j) => j.title);

    expect(titles).toContain('Software Engineer Intern'); // fresh, matching
    expect(titles).toContain('Robotics Co-op'); // unknown date, kept for the unknown bucket
    expect(titles).not.toContain('Senior ML Engineer'); // no intern/co-op in title
    expect(titles).not.toContain('Machine Learning Intern'); // THE TRAP: first_published 500d
    expect(titles).not.toContain('Data Intern'); // deadline passed
    expect(titles).not.toContain('Intern Program Manager'); // exclude pattern
    expect(jobs).toHaveLength(2);
  });

  it('uses first_published as postedAt, never updated_at', async () => {
    const jobs = await scanner.scanPublic({});
    const swe = jobs.find((j) => j.title === 'Software Engineer Intern')!;
    expect(Date.parse(swe.postedAt)).toBe(Date.parse(daysAgo(3)));
  });

  it('unknown first_published becomes empty postedAt (pipeline unknown bucket)', async () => {
    const jobs = await scanner.scanPublic({});
    const coop = jobs.find((j) => j.title === 'Robotics Co-op')!;
    expect(coop.postedAt).toBe('');
    expect(coop.remote).toBe(true);
  });

  it('fetches and de-escapes the full JD', async () => {
    const jobs = await scanner.scanPublic({});
    expect(jobs[0]!.jd).toBe('Build & ship robots');
  });

  it('a 404 board is skipped without killing the scan', async () => {
    const jobs = await scanner.scanPublic({});
    expect(jobs.length).toBeGreaterThan(0); // acme still scanned after deadboard 404
  });

  it('respects a tighter postedWithinDays from the query', async () => {
    const jobs = await scanner.scanPublic({ postedWithinDays: 2 });
    // 3-day-old SWE intern now too old; co-op (unknown) survives.
    expect(jobs.map((j) => j.title)).toEqual(['Robotics Co-op']);
  });
});

describe('htmlToText', () => {
  it('decodes entities then strips tags, ampersand last', () => {
    expect(htmlToText('&lt;ul&gt;&lt;li&gt;C&amp;amp;C++&lt;/li&gt;&lt;/ul&gt;')).toBe('C&C++');
  });
});
