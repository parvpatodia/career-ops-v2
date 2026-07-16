/**
 * mapPool is the concurrency primitive behind the 60s watch sweep. The
 * load-bearing property: results come back in INPUT order regardless of when
 * each task resolves, so the board scanners' Job output (and their ids) are
 * identical to a serial run. It must also cap in-flight work.
 */
import { describe, it, expect } from 'vitest';
import { mapPool } from '../../src/utils/pool.js';

describe('mapPool', () => {
  it('preserves input order even when later items resolve first', async () => {
    const delays = [30, 5, 20, 1, 15];
    const out = await mapPool(delays, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    }, 3);
    expect(out).toEqual(['0:30', '1:5', '2:20', '3:1', '4:15']);
  });

  it('never runs more than `concurrency` tasks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
    }, 4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles an empty list without spawning a worker', async () => {
    expect(await mapPool([], async (x) => x, 8)).toEqual([]);
  });
});
