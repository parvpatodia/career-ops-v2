import { describe, it, expect } from 'vitest';
import { assessHunterBudget } from '../../src/outreach/budget.js';
import type { AccountQuota } from '../../src/outreach/HunterClient.js';

function acct(over: Partial<AccountQuota> = {}): AccountQuota {
  return { plan: 'Free', searchesUsed: 0, searchesAvailable: 50, verificationsUsed: 0, verificationsAvailable: 100, ...over };
}

describe('assessHunterBudget', () => {
  it('is ok when plenty of credit remains', () => {
    expect(assessHunterBudget(acct(), 3, 5).level).toBe('ok');
  });

  it('is low when remaining searches or verifications are below what the run needs', () => {
    expect(assessHunterBudget(acct({ searchesUsed: 48 }), 3, 5).level).toBe('low'); // 2 searches left, wants 3
    expect(assessHunterBudget(acct({ verificationsUsed: 97 }), 3, 5).level).toBe('low'); // 3 verifications left, wants 5
  });

  it('is exhausted when no searches remain', () => {
    const s = assessHunterBudget(acct({ searchesUsed: 50 }), 3, 5);
    expect(s.level).toBe('exhausted');
    expect(s.remainingSearches).toBe(0);
    expect(s.message).toMatch(/exhausted/);
  });

  it('never reports negative remaining when used exceeds available', () => {
    const s = assessHunterBudget(acct({ searchesUsed: 60, verificationsUsed: 120 }), 3, 5);
    expect(s.remainingSearches).toBe(0);
    expect(s.remainingVerifications).toBe(0);
    expect(s.level).toBe('exhausted');
  });
});
