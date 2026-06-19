import { describe, it, expect } from 'vitest';
import { HunterClient, HunterError, type HunterFetch } from '../../src/outreach/HunterClient.js';

/** Build a fake fetch that returns a queue of responses, recording the URLs hit. */
function fakeFetch(responses: Array<{ status: number; body: unknown }>): {
  fetchFn: HunterFetch;
  urls: string[];
} {
  const urls: string[] = [];
  let i = 0;
  const fetchFn: HunterFetch = async (url) => {
    urls.push(url);
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return {
      status: r.status,
      ok: r.status < 400,
      json: async () => r.body,
    };
  };
  return { fetchFn, urls };
}

const noSleep = async () => {};

describe('HunterClient', () => {
  it('requires an api key', () => {
    expect(() => new HunterClient({ apiKey: '' })).toThrow(HunterError);
  });

  it('passes the key in the X-API-KEY header, never the URL', async () => {
    const captured: Record<string, string> = {};
    const fetchFn: HunterFetch = async (url, init) => {
      Object.assign(captured, init?.headers);
      expect(url).not.toContain('secret-key');
      return { status: 200, ok: true, json: async () => ({ data: {} }) };
    };
    const c = new HunterClient({ apiKey: 'secret-key', fetchFn });
    await c.account();
    expect(captured['X-API-KEY']).toBe('secret-key');
  });

  it('parses account quota', async () => {
    const { fetchFn } = fakeFetch([
      {
        status: 200,
        body: {
          data: {
            plan_name: 'Starter',
            requests: {
              searches: { used: 12, available: 500 },
              verifications: { used: 3, available: 1000 },
            },
          },
        },
      },
    ]);
    const c = new HunterClient({ apiKey: 'k', fetchFn });
    const q = await c.account();
    expect(q.plan).toBe('Starter');
    expect(q.searchesAvailable).toBe(500);
    expect(q.verificationsUsed).toBe(3);
  });

  it('parses domain search emails', async () => {
    const { fetchFn } = fakeFetch([
      {
        status: 200,
        body: {
          data: {
            emails: [
              { value: 'jane@lab.edu', type: 'personal', confidence: 94, position: 'PhD student' },
              { value: 'info@lab.edu', type: 'generic', confidence: 50 },
            ],
          },
        },
      },
    ]);
    const c = new HunterClient({ apiKey: 'k', fetchFn });
    const emails = await c.domainSearch({ domain: 'lab.edu' });
    expect(emails).toHaveLength(2);
    expect(emails[0]!.value).toBe('jane@lab.edu');
    expect(emails[0]!.confidence).toBe(94);
  });

  it('finds an email by linkedin handle', async () => {
    const { fetchFn, urls } = fakeFetch([
      { status: 200, body: { data: { email: 'sam@startup.ai', score: 88 } } },
    ]);
    const c = new HunterClient({ apiKey: 'k', fetchFn });
    const r = await c.emailFinder({ linkedinHandle: 'samdoe', fullName: 'Sam Doe' });
    expect(r.email).toBe('sam@startup.ai');
    expect(r.score).toBe(88);
    expect(urls[0]).toContain('linkedin_handle=samdoe');
  });

  it('polls past a 202 then returns the verified status', async () => {
    const { fetchFn } = fakeFetch([
      { status: 202, body: {} },
      { status: 200, body: { data: { email: 'x@y.com', status: 'valid', score: 97 } } },
    ]);
    const c = new HunterClient({ apiKey: 'k', fetchFn, sleep: noSleep, verifyDelayMs: 0 });
    const v = await c.emailVerifier('x@y.com');
    expect(v.status).toBe('valid');
    expect(v.score).toBe(97);
  });

  it('returns unknown if the verifier never settles', async () => {
    const { fetchFn } = fakeFetch([{ status: 202, body: {} }]);
    const c = new HunterClient({ apiKey: 'k', fetchFn, sleep: noSleep, verifyMaxAttempts: 2 });
    const v = await c.emailVerifier('x@y.com');
    expect(v.status).toBe('unknown');
  });

  it('throws HunterError on an API error payload', async () => {
    const { fetchFn } = fakeFetch([
      { status: 401, body: { errors: [{ details: 'Invalid API key' }] } },
    ]);
    const c = new HunterClient({ apiKey: 'k', fetchFn });
    await expect(c.account()).rejects.toThrow(/Invalid API key/);
  });
});
