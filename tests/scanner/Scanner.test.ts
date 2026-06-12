import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Scanner } from '../../src/scanner/Scanner.js';
import type { Job, Platform, ScanQuery } from '../../src/types.js';

// WHY the injected cacheDir: with the default path these mocks wrote
// TestCo fixtures into the real data/daily_log for a month, and on
// 2026-06-12 the pipeline queued them as real applications (LESSONS.md).
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

class MockScanner extends Scanner {
  readonly platform: Platform = 'direct';
  private mockJobs: Job[];

  constructor(jobs: Job[] = [], cacheDir?: string) {
    super(cacheDir ?? tmpDir);
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

const QUERY: ScanQuery = { keywords: ['ML Engineer'], location: 'Bay Area' };

describe('Scanner (abstract base via MockScanner)', () => {
  it('returns jobs from scan() and writes the cache inside the injected dir only', async () => {
    const jobs = [makeJob(), makeJob({ id: 'direct-def456', company: 'OtherCo' })];
    const scanner = new MockScanner(jobs);
    const results = await scanner.scanWithCache(QUERY);
    expect(results).toHaveLength(2);

    const written = fs.readdirSync(tmpDir);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/direct/);
  });

  it('returns empty array when no jobs found', async () => {
    const scanner = new MockScanner([]);
    const results = await scanner.scanWithCache(QUERY);
    expect(results).toHaveLength(0);
  });

  it('caches results: second call does not re-invoke scan()', async () => {
    let callCount = 0;
    class CountingScanner extends Scanner {
      readonly platform: Platform = 'direct';
      constructor() {
        super(tmpDir);
      }
      protected async scan(_q: ScanQuery): Promise<Job[]> {
        callCount++;
        return [makeJob()];
      }
    }
    const scanner = new CountingScanner();
    await scanner.scanWithCache(QUERY);
    await scanner.scanWithCache(QUERY);
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
