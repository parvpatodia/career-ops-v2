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

  it('caps picks per org with maxPerOrg, spreading across companies', () => {
    const pool = [
      cand({ email: 'a1@x', org: 'A' }), cand({ email: 'a2@x', org: 'A' }), cand({ email: 'a3@x', org: 'A' }),
      cand({ email: 'b1@x', org: 'B' }), cand({ email: 'b2@x', org: 'B' }),
      cand({ email: 'c1@x', org: 'C' }),
    ];
    const r = pickFresh(pool, { limit: 10, needEmail: true, seen: new Set(), isSuppressed: () => false, maxPerOrg: 2, idOf });
    const byOrg = r.reduce<Record<string, number>>((m, c) => { m[c.org] = (m[c.org] ?? 0) + 1; return m; }, {});
    expect(byOrg).toEqual({ A: 2, B: 2, C: 1 }); // A's 3rd skipped; batch spans 3 orgs
  });

  it('defaults idOf to Drafter.contactId', () => {
    const r = pickFresh([cand({ email: 'a@x.com' })], { limit: 5, needEmail: true, seen: new Set(), isSuppressed: () => false });
    expect(r).toHaveLength(1);
  });
});
