/**
 * SPEC M7: the apply-time Greenhouse schema fetch. URL parsing is pure; the
 * fetch is injected, so the null-on-failure contract is tested with no network.
 */

import { describe, it, expect } from 'vitest';
import {
  parseGreenhouseRef,
  GreenhouseBoardJobProvider,
} from '../../src/orchestrator/GreenhouseBoardJobFetcher.js';
import type { FetchLike } from '../../src/scanner/GreenhouseBoardScanner.js';
import type { Application } from '../../src/types.js';

function app(url: string): Application {
  return {
    id: '001', jobId: 'j1', date: '2026-06-16', company: 'Globex', role: 'ML Intern',
    score: 80, url, status: 'Ready', resumeVariant: 'ml', notes: 'greenhouse | Remote',
  };
}

describe('parseGreenhouseRef', () => {
  it('parses boards.greenhouse.io/{token}/jobs/{id}', () => {
    expect(parseGreenhouseRef('https://boards.greenhouse.io/globex/jobs/8675309'))
      .toEqual({ token: 'globex', jobId: '8675309' });
  });

  it('parses the job-boards.greenhouse.io host', () => {
    expect(parseGreenhouseRef('https://job-boards.greenhouse.io/acme/jobs/42?gh_src=x'))
      .toEqual({ token: 'acme', jobId: '42' });
  });

  it('parses the /embed/job_app form (for=token, token=jobId)', () => {
    expect(parseGreenhouseRef('https://job-boards.greenhouse.io/embed/job_app?for=bluerivertech&token=7947246'))
      .toEqual({ token: 'bluerivertech', jobId: '7947246' });
  });

  it('returns null for non-Greenhouse / token-less URLs', () => {
    expect(parseGreenhouseRef('https://jobs.lever.co/globex/123')).toBeNull();
    expect(parseGreenhouseRef('https://careers.globex.com/apply?gh_jid=999')).toBeNull();
  });
});

describe('GreenhouseBoardJobProvider', () => {
  it('returns the job JSON on a 200', async () => {
    const fetchFn: FetchLike = async (url) => {
      expect(url).toBe('https://boards-api.greenhouse.io/v1/boards/globex/jobs/8675309?questions=true');
      return { ok: true, status: 200, json: async () => ({ id: 8675309, questions: [] }) };
    };
    const r = await new GreenhouseBoardJobProvider(fetchFn).provide(app('https://boards.greenhouse.io/globex/jobs/8675309'));
    expect(r).toEqual({ id: 8675309, questions: [] });
  });

  it('abstains (null) on an unparseable URL — never fetches', async () => {
    let called = false;
    const fetchFn: FetchLike = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    const r = await new GreenhouseBoardJobProvider(fetchFn).provide(app('https://careers.globex.com/apply?gh_jid=999'));
    expect(r).toBeNull();
    expect(called).toBe(false);
  });

  it('abstains (null) on an HTTP error', async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await new GreenhouseBoardJobProvider(fetchFn).provide(app('https://boards.greenhouse.io/globex/jobs/1'));
    expect(r).toBeNull();
  });

  it('abstains (null) when fetch throws (network down)', async () => {
    const fetchFn: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    const r = await new GreenhouseBoardJobProvider(fetchFn).provide(app('https://boards.greenhouse.io/globex/jobs/1'));
    expect(r).toBeNull();
  });
});
