/**
 * The cover-letter OPENING is the only machine-generated prose in the pipeline
 * cover-letter path, and it ships to employers. It regressed once with "excited"
 * (a banned AI-filler word) baked into the hardcoded string. These assert the
 * generated opening names the role + company and stays free of the SAME
 * forbidden vocabulary the CoverLetterVerifier enforces, using the SAME matcher
 * (single source of the forbidden list, so the two can never disagree).
 */
import { describe, it, expect } from 'vitest';
import { buildOpening } from '../../src/pipeline/CoverLetterPersonalizer.js';
import { FORBIDDEN_PHRASES } from '../../src/tailor/CoverLetterVerifier.js';
import { containsTerm } from '../../src/tailor/text.js';
import type { ResumeVariant } from '../../src/types.js';

// 'robotics' takes the robotics opening; every other variant maps to ai_ml.
const variants: ResumeVariant[] = ['ml', 'robotics'];

describe('buildOpening', () => {
  for (const v of variants) {
    it(`${v}: names the role and company`, () => {
      const opening = buildOpening(v, 'Machine Learning Intern', 'Waymo');
      expect(opening).toContain('Machine Learning Intern');
      expect(opening).toContain('Waymo');
    });

    it(`${v}: contains no forbidden AI-filler phrase (verifier parity)`, () => {
      const opening = buildOpening(v, 'ML Intern', 'Anthropic');
      const hits = FORBIDDEN_PHRASES.filter((p) => containsTerm(opening, p));
      expect(hits).toEqual([]);
    });

    it(`${v}: contains no em dash`, () => {
      expect(buildOpening(v, 'ML Intern', 'Anthropic')).not.toContain('—');
    });
  }

  it('routes every non-robotics variant to the same ai_ml opening', () => {
    const ai = buildOpening('ai', 'SWE Intern', 'Stripe');
    expect(buildOpening('ml', 'SWE Intern', 'Stripe')).toBe(ai);
    expect(buildOpening('master', 'SWE Intern', 'Stripe')).toBe(ai);
  });
});
