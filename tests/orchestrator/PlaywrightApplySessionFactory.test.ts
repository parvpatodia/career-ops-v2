/**
 * SPEC M7: PlaywrightApplySessionFactory abstain-ordering (no real browser).
 *
 * The factory must decide it cannot fill a portal BEFORE it opens a browser:
 * an unsupported ATS, or Greenhouse with no board-schema provider, returns
 * `unsupported` and never touches the browser. The real fill/submit path
 * (Workday + Greenhouse fixtures, headless Chromium) is proven by
 * `npm run demo:integration`, not in the unit suite.
 */

import { describe, it, expect } from 'vitest';
import type { Browser } from 'playwright';
import { PlaywrightApplySessionFactory } from '../../src/orchestrator/PlaywrightApplySessionFactory.js';
import type { Application } from '../../src/types.js';
import type { AnswerSource } from '../../src/applier/IntentPayload.js';

const noAnswers: AnswerSource = { generate: () => null };

function app(url: string): Application {
  return {
    id: '001',
    jobId: 'j1',
    date: '2026-06-16',
    company: 'Globex',
    role: 'ML Engineer Intern',
    score: 80,
    url,
    status: 'Ready',
    resumeVariant: 'ml',
    notes: 'greenhouse | Remote',
  };
}

/** A browser whose context creation throws if reached — proves it is not reached. */
class SpyBrowser {
  contexts = 0;
  async newContext(): Promise<never> {
    this.contexts++;
    throw new Error('newContext must not be called for an abstained portal');
  }
}

describe('PlaywrightApplySessionFactory (abstain before browser)', () => {
  it('unsupported ATS: returns unsupported, never opens the browser', async () => {
    const spy = new SpyBrowser();
    const factory = new PlaywrightApplySessionFactory({ browser: spy as unknown as Browser });

    const r = await factory.open(app('https://jobs.lever.co/globex/123'), noAnswers);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ats).toBe('lever');
    expect(spy.contexts).toBe(0);
  });

  it('Greenhouse with no board-job provider: abstains, never opens the browser', async () => {
    const spy = new SpyBrowser();
    const factory = new PlaywrightApplySessionFactory({ browser: spy as unknown as Browser });

    const r = await factory.open(app('https://boards.greenhouse.io/globex/jobs/1'), noAnswers);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ats).toMatch(/greenhouse/);
    expect(spy.contexts).toBe(0);
  });
});
