/**
 * The auto-tailor generates its own cover-letter template at runtime (instead of
 * the manual cv/ one, whose "[instruction]" lines carry em dashes that abstained
 * every letter). Guard that the generated template is clean and complete.
 */
import { describe, it, expect } from 'vitest';
import { buildCoverTemplate } from '../../src/tailor/cli/tailorFresh.js';

const id = {
  name: 'Parv Patodia',
  phone: '000-000-0000',
  email: 'p@x.edu',
  location: 'San Jose, CA',
  program: 'MS in AI',
  university: 'Northeastern',
};

describe('buildCoverTemplate', () => {
  it('has every placeholder the CoverLetterBuilder fills', () => {
    const t = buildCoverTemplate(id);
    for (const ph of ['{{DATE}}', '{{COMPANY_NAME}}', '{{ROLE_TITLE}}', '{{PARA_1_WHY_COMPANY}}', '{{PARA_2_STRONGEST_PROJECT}}', '{{PARA_3_EXPERIENCE_ALIGNMENT}}', '{{PARA_4_CLOSE}}']) {
      expect(t).toContain(ph);
    }
  });

  it('carries no dash and no leftover "[instruction]" guidance (the abstain cause)', () => {
    const t = buildCoverTemplate(id);
    expect(t).not.toMatch(/[–—―]|--/);
    expect(t).not.toMatch(/\[[^\]]*\]/); // no bracketed instruction lines
  });

  it('grounds the header in the real identity (name present for the verifier)', () => {
    const t = buildCoverTemplate(id);
    expect(t).toContain('Parv Patodia');
    expect(t).toContain('Northeastern');
  });
});
