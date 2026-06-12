/**
 * Test group 6 (SPEC M1): property test. Any event sequence the store
 * accepts must fold into a legal state, and the store must never crash on
 * a random sequence. Seeded PRNG so failures reproduce exactly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventStore, TransitionError } from '../../src/store/EventStore.js';
import { EVENT_TYPES } from '../../src/store/events.js';

// mulberry32: tiny deterministic PRNG. WHY seeded: a failing random test
// that cannot be replayed teaches nothing.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALID_STATUSES = new Set([
  'Ready', 'Evaluated', 'Applied', 'Responded', 'Interview', 'Offer',
  'Rejected', 'Discarded', 'Closed', 'SKIP',
]);

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'property-'));
  file = path.join(dir, 'events.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Projection property test', () => {
  it('500 random events: store never crashes, final state is legal (seed 42)', () => {
    const rand = mulberry32(42);
    const store = new EventStore(file);
    const appIds = Array.from({ length: 20 }, (_, i) =>
      (String(i).padStart(2, '0') + 'abcdefabcdef').slice(0, 12)
    );

    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 500; i++) {
      const type = EVENT_TYPES[Math.floor(rand() * EVENT_TYPES.length)]!;
      const appId = appIds[Math.floor(rand() * appIds.length)]!;
      const payload =
        type === 'queued'
          ? {
              application: {
                id: String(i).padStart(3, '0'),
                jobId: `job-${i}`,
                date: '2026-06-11',
                company: `Co${appId}`,
                role: 'Intern',
                score: Math.floor(rand() * 100),
                url: 'https://example.com',
                status: 'Ready',
                resumeVariant: 'master',
                notes: '',
              },
            }
          : { i };
      try {
        store.append({ type, appId, payload });
        accepted++;
      } catch (e) {
        if (!(e instanceof TransitionError)) throw e;
        rejected++;
      }
    }

    expect(accepted + rejected).toBe(500);
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0); // duplicate submits must have occurred

    const proj = store.projection();
    for (const app of proj.all()) {
      expect(VALID_STATUSES.has(app.status)).toBe(true);
    }
    // Invariant: confirmed implies submitted.
    for (const appId of appIds) {
      if (proj.isConfirmed(appId)) expect(proj.isSubmitted(appId)).toBe(true);
    }
    // Seq is strictly increasing with no duplicates.
    const { events } = store.readAll();
    const seqs = events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  }, 30_000);
});
