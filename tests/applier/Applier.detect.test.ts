/**
 * Applier.detect() tests — static URL-to-ATS routing.
 * This is the entry point for handler selection; a wrong mapping means
 * every fill attempt uses the wrong DOM selectors.
 */

import { describe, it, expect } from 'vitest';
import { Applier } from '../../src/applier/Applier.js';

describe('Applier.detect', () => {
  it('detects greenhouse.io', () => {
    expect(Applier.detect('https://job-boards.greenhouse.io/openai/jobs/123')).toBe('greenhouse');
  });

  it('detects boards.greenhouse legacy domain', () => {
    expect(Applier.detect('https://boards.greenhouse.io/acme')).toBe('greenhouse');
  });

  it('detects lever.co', () => {
    expect(Applier.detect('https://jobs.lever.co/anthropic/abc-123')).toBe('lever');
  });

  it('detects myworkdayjobs.com', () => {
    expect(Applier.detect('https://nvidia.wd5.myworkdayjobs.com/en-US/job/AI-Intern')).toBe('workday');
  });

  it('detects myworkdaysite.com', () => {
    expect(Applier.detect('https://company.myworkdaysite.com/apply')).toBe('workday');
  });

  it('detects linkedin.com/jobs', () => {
    expect(Applier.detect('https://www.linkedin.com/jobs/view/4233946786')).toBe('linkedin');
  });

  it('detects ashbyhq.com', () => {
    expect(Applier.detect('https://jobs.ashbyhq.com/cohere/role-id')).toBe('ashby');
  });

  it('detects handshake posting URL', () => {
    expect(Applier.detect('https://app.joinhandshake.com/stu/postings/12345')).toBe('handshake');
  });

  it('returns generic for custom career domains', () => {
    expect(Applier.detect('https://lifeattiktok.com/search/7572665')).toBe('generic');
    expect(Applier.detect('https://careers.tesla.com/en/jobs/1234')).toBe('generic');
    expect(Applier.detect('https://careers-jobyaviation.icims.com/jobs/4413/job')).toBe('generic');
  });

  it('returns generic for unknown domains', () => {
    expect(Applier.detect('https://example.com/jobs/software-engineer')).toBe('generic');
  });
});
