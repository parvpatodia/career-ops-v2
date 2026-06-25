/**
 * AshbyBoardScanner against a faked Ashby posting API. Mirrors the Greenhouse/
 * Lever scanners' guarantees: structured source, real publishedAt date, full JD,
 * role targeting by title OR employmentType, and unlisted postings skipped.
 */

import { describe, it, expect } from 'vitest';
import { AshbyBoardScanner } from '../../src/scanner/AshbyBoardScanner.js';
import type { FetchLike, AshbyBoardsConfig } from '../../src/scanner/AshbyBoardScanner.js';
import type { Job, ScanQuery } from '../../src/types.js';

const NOW = Date.now();
const daysAgoIso = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const CFG: AshbyBoardsConfig = {
  companies: ['acme', 'deadco'],
  titleInclude: ['intern', 'co-op'],
  titleExclude: ['manager', 'senior'],
};

const JOBS = [
  {
    id: 'a1', title: 'Software Engineer Intern', employmentType: 'Intern',
    location: 'San Jose, CA', publishedAt: daysAgoIso(3), isListed: true,
    applyUrl: 'https://jobs.ashbyhq.com/acme/a1', jobUrl: 'https://jobs.ashbyhq.com/acme/a1',
    descriptionPlain: 'Build distributed systems.',
  },
  {
    // No "intern" in the title, but employmentType=Intern -> kept.
    id: 'a2', title: 'Machine Learning Engineer (University Grad)', employmentType: 'Intern',
    location: 'Remote - US', publishedAt: daysAgoIso(1), isListed: true, isRemote: true,
    applyUrl: 'https://jobs.ashbyhq.com/acme/a2', descriptionPlain: 'Train models.',
  },
  {
    id: 'a3', title: 'Senior Software Engineer', employmentType: 'FullTime',
    publishedAt: daysAgoIso(1), isListed: true, applyUrl: 'https://jobs.ashbyhq.com/acme/a3',
  },
  {
    id: 'a4', title: 'Engineering Intern Manager', employmentType: 'FullTime',
    publishedAt: daysAgoIso(1), isListed: true, applyUrl: 'https://jobs.ashbyhq.com/acme/a4',
  },
  {
    id: 'a5', title: 'Data Science Intern', employmentType: 'Intern',
    publishedAt: daysAgoIso(40), isListed: true, applyUrl: 'https://jobs.ashbyhq.com/acme/a5', // stale
  },
  {
    id: 'a6', title: 'Robotics Co-op', employmentType: 'Intern',
    isListed: true, applyUrl: 'https://jobs.ashbyhq.com/acme/a6', // no publishedAt -> unknown bucket
  },
  {
    id: 'a7', title: 'Hidden Intern', employmentType: 'Intern',
    publishedAt: daysAgoIso(1), isListed: false, applyUrl: 'https://jobs.ashbyhq.com/acme/a7', // unlisted
  },
];

const fakeFetch: FetchLike = async (url: string) => {
  if (url.includes('/deadco')) return { ok: false, status: 404, json: async () => ({}) };
  if (url.includes('/acme')) return { ok: true, status: 200, json: async () => ({ jobs: JOBS, apiVersion: '1' }) };
  return { ok: false, status: 404, json: async () => ({}) };
};

class Testable extends AshbyBoardScanner {
  scanPublic(q: ScanQuery): Promise<Job[]> {
    return this.scan(q);
  }
}

describe('AshbyBoardScanner', () => {
  const scanner = new Testable(CFG, fakeFetch);

  it('keeps fresh intern/co-op roles by title OR employmentType, excludes the rest for the right reasons', async () => {
    const titles = (await scanner.scanPublic({})).map((j) => j.title);
    expect(titles).toContain('Software Engineer Intern');                 // title + type
    expect(titles).toContain('Machine Learning Engineer (University Grad)'); // employmentType=Intern
    expect(titles).toContain('Robotics Co-op');                            // unknown date, kept
    expect(titles).not.toContain('Senior Software Engineer');              // exclude "senior"
    expect(titles).not.toContain('Engineering Intern Manager');           // exclude "manager" wins
    expect(titles).not.toContain('Data Science Intern');                   // stale (40d)
    expect(titles).not.toContain('Hidden Intern');                         // isListed=false
    expect(titles).toHaveLength(3);
  });

  it('uses publishedAt as postedAt and tags platform=ashby', async () => {
    const swe = (await scanner.scanPublic({})).find((j) => j.title === 'Software Engineer Intern')!;
    expect(Math.round(Date.parse(swe.postedAt) / 1000)).toBe(Math.round((NOW - 3 * 86_400_000) / 1000));
    expect(swe.platform).toBe('ashby');
    expect(swe.id.startsWith('ashby-')).toBe(true);
    expect(swe.jd).toContain('Build distributed systems.');
    expect(swe.applyUrl).toBe('https://jobs.ashbyhq.com/acme/a1');
  });

  it('unknown publishedAt becomes empty postedAt (pipeline unknown bucket)', async () => {
    const coop = (await scanner.scanPublic({})).find((j) => j.title === 'Robotics Co-op')!;
    expect(coop.postedAt).toBe('');
  });

  it('a 404 board is skipped without killing the scan', async () => {
    expect((await scanner.scanPublic({})).length).toBeGreaterThan(0);
  });

  it('respects a tighter postedWithinDays', async () => {
    const titles = (await scanner.scanPublic({ postedWithinDays: 2 })).map((j) => j.title);
    expect(titles).toContain('Machine Learning Engineer (University Grad)'); // 1d
    expect(titles).toContain('Robotics Co-op');                            // unknown date survives
    expect(titles).not.toContain('Software Engineer Intern');              // 3d > 2d
  });
});
