import { describe, it, expect } from 'vitest';
import { pickFresh } from '../../src/outreach/selectCandidates.js';
import type { Candidate } from '../../src/outreach/types.js';

function cand(over: Partial<Candidate> = {}): Candidate {
  return { name: 'X', segment: 'industry', org: 'Co', sourceUrl: 'u', hook: 'h', ...over };
}
const idOf = (c: Candidate) => c.email ?? c.name;

describe('pickFresh', () => {
  it('caps at limit', () => {
    const pool = [cand({ email: 'a@x' }), cand({ email: 'b@x' }), cand({ email: 'c@x' })];
    const r = pickFresh(pool, { limit: 2, needEmail: true, seen: new Set(), isSuppressed: () => false, idOf });
    expect(r).toHaveLength(2);
  });

  it('skips emailless candidates when needEmail is set', () => {
    const pool = [cand({ name: 'noemail' }), cand({ email: 'a@x' })];
    const r = pickFresh(pool, { limit: 5, needEmail: true, seen: new Set(), isSuppressed: () => false, idOf });
    expect(r.map((c) => c.email)).toEqual(['a@x']);
  });

  it('skips suppressed contacts', () => {
    const pool = [cand({ email: 'a@x' }), cand({ email: 'b@x' })];
    const r = pickFresh(pool, { limit: 5, needEmail: true, seen: new Set(), isSuppressed: (id) => id === 'a@x', idOf });
    expect(r.map((c) => c.email)).toEqual(['b@x']);
  });

  it('dedups duplicates within a pass', () => {
    const pool = [cand({ email: 'a@x' }), cand({ email: 'a@x' })];
    const r = pickFresh(pool, { limit: 5, needEmail: true, seen: new Set(), isSuppressed: () => false, idOf });
    expect(r).toHaveLength(1);
  });

  it('marks ONLY kept candidates seen, leaving over-cap ones for a later pass (the shipped bug)', () => {
    const seen = new Set<string>();
    const pool = [cand({ email: 'a@x' }), cand({ email: 'b@x' }), cand({ email: 'c@x' })];

    const first = pickFresh(pool, { limit: 1, needEmail: true, seen, isSuppressed: () => false, idOf });
    expect(first.map((c) => c.email)).toEqual(['a@x']);
    expect(seen.has('b@x')).toBe(false); // NOT pre-marked despite being inspected

    const second = pickFresh(pool, { limit: 5, needEmail: false, seen, isSuppressed: () => false, idOf });
    expect(second.map((c) => c.email)).toEqual(['b@x', 'c@x']); // a@x already used; b,c still available
  });

  it('defaults idOf to Drafter.contactId', () => {
    const r = pickFresh([cand({ email: 'a@x.com' })], { limit: 5, needEmail: true, seen: new Set(), isSuppressed: () => false });
    expect(r).toHaveLength(1);
  });
});
