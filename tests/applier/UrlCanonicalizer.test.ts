/**
 * UrlCanonicalizer: strips Simplify/tracking params and resolves an embedded
 * Greenhouse gh_jid URL to the first-party board URL (fetching the embed token).
 * Regression for the 2026-07-12 finding: every Ready job was a Simplify-wrapped
 * aggregator link, and the Blue River embed (company.com/job?gh_jid=NNN) could
 * not be filled. Fake fetch — no network.
 */

import { describe, it, expect } from 'vitest';
import {
  UrlCanonicalizer,
  stripTrackingParams,
  parseGhJid,
  isCanonicalGreenhouse,
  extractGreenhouseEmbedToken,
  greenhouseEmbedAppUrl,
  type HtmlFetchLike,
} from '../../src/applier/UrlCanonicalizer.js';

const BLUE_RIVER_HTML =
  '<html><head><script src="https://boards.greenhouse.io/embed/job_board/js?for=bluerivertech"></script></head><body>2026 Machine Learning Intern</body></html>';

const fakeFetch = (html: string, ok = true): HtmlFetchLike =>
  async () => ({ ok, status: ok ? 200 : 404, text: async () => html });

describe('stripTrackingParams', () => {
  it('drops Simplify utm_source/ref but keeps gh_jid', () => {
    expect(stripTrackingParams('https://www.bluerivertechnology.com/job/?gh_jid=7947246&utm_source=Simplify&ref=Simplify'))
      .toBe('https://www.bluerivertechnology.com/job/?gh_jid=7947246');
  });

  it('strips params off a canonical Greenhouse URL, leaving it intact', () => {
    expect(stripTrackingParams('https://job-boards.greenhouse.io/brightai/jobs/6002012004?utm_source=Simplify&ref=Simplify'))
      .toBe('https://job-boards.greenhouse.io/brightai/jobs/6002012004');
  });

  it('returns the input unchanged when there are no tracking params', () => {
    expect(stripTrackingParams('https://jobs.lever.co/acme/abc-123')).toBe('https://jobs.lever.co/acme/abc-123');
  });

  it('does not throw on an unparseable URL', () => {
    expect(stripTrackingParams('not a url')).toBe('not a url');
  });
});

describe('parseGhJid / isCanonicalGreenhouse / extract token', () => {
  it('extracts a numeric gh_jid', () => {
    expect(parseGhJid('https://x.com/job/?gh_jid=7947246&ref=Simplify')).toBe('7947246');
    expect(parseGhJid('https://x.com/job/?gh_jid=abc')).toBeNull();
    expect(parseGhJid('https://x.com/job/')).toBeNull();
  });

  it('recognizes a first-party Greenhouse board URL', () => {
    expect(isCanonicalGreenhouse('https://job-boards.greenhouse.io/brightai/jobs/6002012004')).toBe(true);
    expect(isCanonicalGreenhouse('https://boards.greenhouse.io/acme/jobs/12345')).toBe(true);
    expect(isCanonicalGreenhouse('https://www.bluerivertechnology.com/job/?gh_jid=7947246')).toBe(false);
  });

  it('reads the board token from the embed script', () => {
    expect(extractGreenhouseEmbedToken(BLUE_RIVER_HTML)).toBe('bluerivertech');
    expect(extractGreenhouseEmbedToken('<html>no greenhouse here</html>')).toBeNull();
  });

  it('builds the bare Greenhouse application-form URL (for=token, token=jobId)', () => {
    expect(greenhouseEmbedAppUrl('bluerivertech', '7947246'))
      .toBe('https://job-boards.greenhouse.io/embed/job_app?for=bluerivertech&token=7947246');
  });
});

describe('UrlCanonicalizer.canonicalize', () => {
  it('resolves an embedded gh_jid URL to the bare first-party application form', async () => {
    const c = new UrlCanonicalizer(fakeFetch(BLUE_RIVER_HTML));
    const out = await c.canonicalize('https://www.bluerivertechnology.com/job/?gh_jid=7947246&utm_source=Simplify&ref=Simplify');
    expect(out).toBe('https://job-boards.greenhouse.io/embed/job_app?for=bluerivertech&token=7947246');
  });

  it('passes a canonical Greenhouse URL through (only stripping params, no fetch)', async () => {
    let fetched = false;
    const c = new UrlCanonicalizer(async () => { fetched = true; return { ok: true, status: 200, text: async () => '' }; });
    const out = await c.canonicalize('https://job-boards.greenhouse.io/brightai/jobs/6002012004?utm_source=Simplify');
    expect(out).toBe('https://job-boards.greenhouse.io/brightai/jobs/6002012004');
    expect(fetched).toBe(false); // canonical URLs never trigger a page fetch
  });

  it('falls back to the stripped URL when the embed token is not found', async () => {
    const c = new UrlCanonicalizer(fakeFetch('<html>no embed</html>'));
    const out = await c.canonicalize('https://www.acme.com/careers?gh_jid=999&ref=Simplify');
    expect(out).toBe('https://www.acme.com/careers?gh_jid=999');
  });

  it('falls back to the stripped URL when the page fetch fails (never throws)', async () => {
    const c = new UrlCanonicalizer(fakeFetch('', false));
    const out = await c.canonicalize('https://www.acme.com/careers?gh_jid=999');
    expect(out).toBe('https://www.acme.com/careers?gh_jid=999');
  });

  it('leaves a non-Greenhouse custom-ATS URL as the stripped URL (no false resolution)', async () => {
    const c = new UrlCanonicalizer(fakeFetch(BLUE_RIVER_HTML));
    const out = await c.canonicalize('https://jobs.bytedance.com/en/position/753/detail?utm_source=Simplify&ref=Simplify');
    expect(out).toBe('https://jobs.bytedance.com/en/position/753/detail');
  });
});
