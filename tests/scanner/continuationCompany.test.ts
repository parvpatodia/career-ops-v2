import { describe, it, expect } from 'vitest';
import { resolveContinuationCompany } from '../../src/scanner/continuationCompany.js';

describe('resolveContinuationCompany', () => {
  it('passes a real company through and remembers it as the parent', () => {
    expect(resolveContinuationCompany('Uber', '')).toEqual({ company: 'Uber', lastCompany: 'Uber' });
  });

  it('inherits the previous company on a "↳" continuation row', () => {
    expect(resolveContinuationCompany('↳', 'Uber')).toEqual({ company: 'Uber', lastCompany: 'Uber' });
  });

  it('skips a "↳" row with no parent seen yet (never guesses a company)', () => {
    expect(resolveContinuationCompany('↳', '')).toEqual({ company: null, lastCompany: '' });
  });

  it('skips an empty company without disturbing the carried parent', () => {
    expect(resolveContinuationCompany('', 'Uber')).toEqual({ company: null, lastCompany: 'Uber' });
  });

  it('carries the most-recent real company across consecutive continuation rows', () => {
    // Uber, then two ↳ sub-roles, then Speechify, then a ↳ -> Speechify (not Uber).
    let last = '';
    const seq = ['Uber', '↳', '↳', 'Speechify', '↳'];
    const got = seq.map((c) => {
      const r = resolveContinuationCompany(c, last);
      last = r.lastCompany;
      return r.company;
    });
    expect(got).toEqual(['Uber', 'Uber', 'Uber', 'Speechify', 'Speechify']);
  });

  it('prevents the idempotency collision: two unrelated ↳ rows resolve to DIFFERENT companies', () => {
    // The bug: both would have been company "↳" -> appIdFor("↳", role) collision.
    let last = '';
    const a = resolveContinuationCompany('Uber', last); last = a.lastCompany;
    const aSub = resolveContinuationCompany('↳', last); last = aSub.lastCompany;
    const b = resolveContinuationCompany('Speechify', last); last = b.lastCompany;
    const bSub = resolveContinuationCompany('↳', last); last = bSub.lastCompany;
    expect(aSub.company).toBe('Uber');
    expect(bSub.company).toBe('Speechify');
    expect(aSub.company).not.toBe(bSub.company);
  });
});
