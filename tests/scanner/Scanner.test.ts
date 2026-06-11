import { describe, it, expect } from 'vitest';
import { Scanner } from '../../src/scanner/Scanner.js';
import type { Job, Platform, ScanQuery } from '../../src/types.js';

class MockScanner extends Scanner {
  readonly platform: Platform = 'direct';
  private mockJobs: Job[];

  constructor(jobs: Job[] = []) {
    super();
    this.mockJobs = jobs;
  }

  protected async scan(_query: ScanQuery): Promise<Job[]> {
    return this.mockJobs;
  }
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'direct-abc123',
    title: 'ML Engineer Intern',
    company: 'TestCo',
    url: 'https://testco.com/jobs/1',
    platform: 'direct',
    location: 'San Francisco, CA',
    remote: false,
    postedAt: new Date().toISOString(),
    discoveredAt: new Date().toISOString(),
    jd: 'Python, PyTorch required.',
    status: 'discovered',
    ...overrides,
  };
}

// Use unique queries with timestamps so cached results from previous test runs don't collide.
const RUN_ID = Date.now().toString();
const QUERY_1: ScanQuery = { keywords: [`ML Engineer test-1-${RUN_ID}`], location: 'Bay Area' };
const QUERY_2: ScanQuery = { keywords: [`ML Engineer test-2-${RUN_ID}`], location: 'Bay Area' };
const QUERY_CACHE: ScanQuery = { keywords: [`ML Engineer test-cache-${RUN_ID}`], location: 'Bay Area' };

describe('Scanner (abstract base via MockScanner)', () => {
  it('returns jobs from scan()', async () => {
    const jobs = [makeJob(), makeJob({ id: 'direct-def456', company: 'OtherCo' })];
    const scanner = new MockScanner(jobs);
    const results = await scanner.scanWithCache(QUERY_1);
    expect(results).toHaveLength(2);
  });

  it('returns empty array when no jobs found', async () => {
    const scanner = new MockScanner([]);
    const results = await scanner.scanWithCache(QUERY_2);
    expect(results).toHaveLength(0);
  });

  it('caches results: second call does not re-invoke scan()', async () => {
    let callCount = 0;
    class CountingScanner extends Scanner {
      readonly platform: Platform = 'direct';
      protected async scan(_q: ScanQuery): Promise<Job[]> {
        callCount++;
        return [makeJob()];
      }
    }
    const scanner = new CountingScanner();
    await scanner.scanWithCache(QUERY_CACHE);
    await scanner.scanWithCache(QUERY_CACHE);
    // Both calls use the same query → second should hit cache
    expect(callCount).toBe(1);
  });

  it('generateJobId produces stable IDs for same inputs', () => {
    const scanner = new MockScanner();
    const cast = scanner as unknown as { generateJobId: (c: string, t: string, u: string) => string };
    const id1 = cast.generateJobId('TestCo', 'ML Intern', 'https://testco.com/1');
    const id2 = cast.generateJobId('TestCo', 'ML Intern', 'https://testco.com/1');
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^direct-[a-f0-9]{8}$/);
  });

  it('generateJobId produces different IDs for different inputs', () => {
    const scanner = new MockScanner();
    const cast = scanner as unknown as { generateJobId: (c: string, t: string, u: string) => string };
    const id1 = cast.generateJobId('TestCo', 'ML Intern', 'https://testco.com/1');
    const id2 = cast.generateJobId('OtherCo', 'SWE', 'https://other.com/2');
    expect(id1).not.toBe(id2);
  });
});
