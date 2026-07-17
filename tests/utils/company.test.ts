import { describe, it, expect } from 'vitest';
import { isRealCompany, cleanCompanyName } from '../../src/utils/company.js';

describe('isRealCompany', () => {
  it('accepts normal company names', () => {
    for (const c of ['Anthropic', 'Pennsylvania State University', 'JP Morgan Chase', 'deepgram', '1X']) {
      expect(isRealCompany(c)).toBe(true);
    }
  });

  it('rejects blank, placeholder, and term/season labels', () => {
    for (const c of ['', '   ', '(via email:linkedin)', 'Fall 2026', 'Summer 2026', 'Winter 2026', '2026', null, undefined]) {
      expect(isRealCompany(c)).toBe(false);
    }
  });

  it('does NOT reject a real company that merely contains a season word or year', () => {
    for (const c of ['Summer Robotics', '2020 Ventures', 'Studio 2026', 'Fall Line Capital']) {
      expect(isRealCompany(c)).toBe(true);
    }
  });
});

describe('cleanCompanyName', () => {
  it('returns the trimmed name when real, else empty string', () => {
    expect(cleanCompanyName('  Anthropic ')).toBe('Anthropic');
    expect(cleanCompanyName('Fall 2026')).toBe('');
    expect(cleanCompanyName('(via email:x)')).toBe('');
    expect(cleanCompanyName(undefined)).toBe('');
  });
});
