import { describe, it, expect } from 'vitest';
import { waitForConfirmation } from '../../src/applier/waitForConfirmation.js';

/**
 * A deterministic fake clock + sleep: sleep advances the clock instantly, so the
 * polling logic is tested with zero real time and no flakiness.
 */
function fakeTime(start = 0) {
  let t = start;
  let sleeps = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; sleeps += 1; },
    sleepCount: () => sleeps,
  };
}

describe('waitForConfirmation', () => {
  it('returns immediately when the page is already confirmed (no sleep)', async () => {
    const clk = fakeTime();
    const res = await waitForConfirmation({
      readConfirmation: async () => 'Confirmation #GH-1',
      timeoutMs: 300_000,
      intervalMs: 4_000,
      now: clk.now,
      sleep: clk.sleep,
    });
    expect(res).toBe('Confirmation #GH-1');
    expect(clk.sleepCount()).toBe(0); // checked once, never slept
  });

  it('resumes the instant the confirmation appears after a few polls', async () => {
    const clk = fakeTime();
    const seq = [null, null, 'Application submitted'];
    let i = 0;
    const res = await waitForConfirmation({
      readConfirmation: async () => seq[i++] ?? null,
      timeoutMs: 300_000,
      intervalMs: 4_000,
      now: clk.now,
      sleep: clk.sleep,
    });
    expect(res).toBe('Application submitted');
    expect(clk.sleepCount()).toBe(2); // null, null, hit
  });

  it('returns null on timeout when no confirmation ever appears', async () => {
    const clk = fakeTime();
    let calls = 0;
    const res = await waitForConfirmation({
      readConfirmation: async () => { calls++; return null; },
      timeoutMs: 10_000,
      intervalMs: 4_000,
      now: clk.now,
      sleep: clk.sleep,
    });
    expect(res).toBeNull();
    expect(calls).toBeGreaterThan(1); // it kept polling, not a single check
  });

  it('treats a throwing readConfirmation as "not yet", never crashing', async () => {
    const clk = fakeTime();
    const seq: Array<() => Promise<string | null>> = [
      async () => { throw new Error('transient DOM read'); },
      async () => 'Thanks for applying',
    ];
    let i = 0;
    const res = await waitForConfirmation({
      readConfirmation: () => seq[i++]!(),
      timeoutMs: 300_000,
      intervalMs: 4_000,
      now: clk.now,
      sleep: clk.sleep,
    });
    expect(res).toBe('Thanks for applying');
  });

  it('does NOT treat a blank/whitespace read as a real confirmation', async () => {
    const clk = fakeTime();
    const seq = ['   ', '', 'We have received your application'];
    let i = 0;
    const res = await waitForConfirmation({
      readConfirmation: async () => seq[i++] ?? null,
      timeoutMs: 300_000,
      intervalMs: 4_000,
      now: clk.now,
      sleep: clk.sleep,
    });
    expect(res).toBe('We have received your application');
    expect(clk.sleepCount()).toBe(2); // blank + empty skipped, third hit
  });
});
