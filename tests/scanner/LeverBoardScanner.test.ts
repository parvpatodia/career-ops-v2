/**
 * LeverBoardScanner against a faked Lever postings API. Mirrors the Greenhouse
 * scanner's guarantees: structured source, real createdAt date, full JD, and
 * role targeting by title OR categories.commitment.
 */

import { describe, it, expect } from 'vitest';
import { LeverBoardScanner } from '../../src/scanner/LeverBoardScanner.js';
import type { FetchLike, LeverBoardsConfig } from '../../src/scanner/LeverBoardScanner.js';
import type { Job, ScanQuery } from '../../src/types.js';

const NOW = Date.now();
const daysAgoMs = (n: number) => NOW - n * 86_400_000;

const CFG: LeverBoardsConfig = {
  companies: ['acme', 'deadco'],
  titleInclude: ['intern', 'co-op'],
  titleExclude: ['manager'],
};

const POSTINGS = [
  {
    id: 'a1',
    text: 'Software Engineer Intern',
    hostedUrl: 'https://jobs.lever.co/acme/a1',
    categories: { commitment: 'Internship', location: 'San Jose, CA' },
    createdAt: daysAgoMs(3),
    descriptionPlain: 'Build systems.',
    lists: [{ text: 'Requirements', content: '<li>Python &amp; PyTorch</li>' }],
  },
  {
    // No "intern" in the title, but commitment says Internship -> kept.
    id: 'a2',
    text: 'Machine Learning Engineer (University Grad)',
    hostedUrl: 'https://jobs.lever.co/acme/a2',
    categories: { commitment: 'Intern', location: 'Remote - US' },
    createdAt: daysAgoMs(1),
    descriptionPlain: 'Train models.',
  },
  {
    id: 'a3',
    text: 'Senior Software Engineer',
    hostedUrl: 'https://jobs.lever.co/acme/a3',
    categories: { commitment: 'Full-time' },
    createdAt: daysAgoMs(1),
  },
  {
    id: 'a4',
    text: 'Engineering Intern Manager',
    hostedUrl: 'https://jobs.lever.co/acme/a4',
    categories: { commitment: 'Full-time' },
    createdAt: daysAgoMs(1),
  },
  {
    id: 'a5',
    text: 'Data Science Intern',
    hostedUrl: 'https://jobs.lever.co/acme/a5',
    categories: { commitment: 'Internship' },
    createdAt: daysAgoMs(40), // stale
  },
  {
    id: 'a6',
    text: 'Robotics Co-op',
    hostedUrl: 'https://jobs.lever.co/acme/a6',
    categories: { commitment: 'Internship' },
    // no createdAt -> unknown date bucket
  },
];

const fakeFetch: FetchLike = async (url: string) => {
  if (url.includes('/deadco')) return { ok: false, status: 404, json: async () => ({}) };
  if (url.includes('/acme')) return { ok: true, status: 200, json: async () => POSTINGS };
  return { ok: false, status: 404, json: async () => ({}) };
};

class Testable extends LeverBoardScanner {
  scanPublic(q: ScanQuery): Promise<Job[]> {
    return this.scan(q);
  }
}

describe('LeverBoardScanner', () => {
  const scanner = new Testable(CFG, fakeFetch);

  it('keeps fresh intern/co-op roles by title OR commitment, excludes the rest for the right reasons', async () => {
    const jobs = await scanner.scanPublic({});
    const titles = jobs.map((j) => j.title);

    expect(titles).toContain('Software Engineer Intern'); // title + commitment
    expect(titles).toContain('Machine Learning Engineer (University Grad)'); // commitment=Intern
    expect(titles).toContain('Robotics Co-op'); // unknown date, kept
    expect(titles).not.toContain('Senior Software Engineer'); // full-time, no intern signal
    expect(titles).not.toContain('Engineering Intern Manager'); // exclude pattern wins
    expect(titles).not.toContain('Data Science Intern'); // stale (40d)
    expect(jobs).toHaveLength(3);
  });

  it('uses createdAt as postedAt and tags platform=lever', async () => {
    const jobs = await scanner.scanPublic({});
    const swe = jobs.find((j) => j.title === 'Software Engineer Intern')!;
    expect(Date.parse(swe.postedAt)).toBe(daysAgoMs(3));
    expect(swe.platform).toBe('lever');
    expect(swe.id.startsWith('lever-')).toBe(true);
  });

  it('unknown createdAt becomes empty postedAt (pipeline unknown bucket)', async () => {
    const coop = (await scanner.scanPublic({})).find((j) => j.title === 'Robotics Co-op')!;
    expect(coop.postedAt).toBe('');
  });

  it('builds the JD from descriptionPlain + de-escaped lists', async () => {
    const swe = (await scanner.scanPublic({})).find((j) => j.title === 'Software Engineer Intern')!;
    expect(swe.jd).toContain('Build systems.');
    expect(swe.jd).toContain('Requirements: Python & PyTorch');
  });

  it('does not truncate single-escaped list content at &lt; / &gt; (single-decode)', async () => {
    const posting = {
      id: 'b1',
      text: 'Backend Intern',
      hostedUrl: 'https://jobs.lever.co/acme/b1',
      categories: { commitment: 'Internship' },
      createdAt: daysAgoMs(1),
      descriptionPlain: 'Work on systems.',
      lists: [{ text: 'Requirements', content: '<li>Comfortable when a &lt; b and O(n &lt; 100)</li>' }],
    };
    const fetchOne: FetchLike = async (url) =>
      url.includes('/acme')
        ? { ok: true, status: 200, json: async () => [posting] }
        : { ok: false, status: 404, json: async () => ({}) };
    const jobs = await new Testable({ ...CFG, companies: ['acme'] }, fetchOne).scanPublic({});
    expect(jobs[0]!.jd).toContain('Comfortable when a < b and O(n < 100)');
  });

  it('a 404 company is skipped without killing the scan', async () => {
    expect((await scanner.scanPublic({})).length).toBeGreaterThan(0);
  });

  it('respects a tighter postedWithinDays', async () => {
    const titles = (await scanner.scanPublic({ postedWithinDays: 2 })).map((j) => j.title);
    expect(titles).toContain('Machine Learning Engineer (University Grad)'); // 1d
    expect(titles).toContain('Robotics Co-op'); // unknown date survives
    expect(titles).not.toContain('Software Engineer Intern'); // 3d > 2d
  });
});
