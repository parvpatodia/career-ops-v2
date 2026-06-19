import { describe, it, expect } from 'vitest';
import { Drafter } from '../../src/outreach/Drafter.js';
import { SnippetBook } from '../../src/outreach/SnippetBook.js';
import { DraftGate } from '../../src/outreach/DraftGate.js';
import { StyleLinter } from '../../src/outreach/StyleLinter.js';
import type { Candidate } from '../../src/outreach/types.js';

const snippets = new SnippetBook({
  'industry.intro': "I'm a master's student in AI at Northeastern, and I build AI systems end to end.",
  'industry.detail': 'I wrote a Vision Transformer from scratch in PyTorch and shipped TaskRoute, an LLM routing engine on FastAPI.',
  'industry.coop': 'I am looking for a Fall 2026 co-op starting around August.',
  'common.signature': 'Parv Patodia\nlinkedin.com/in/parvpatodia',
});

const drafter = new Drafter(snippets);

const industryCandidate: Candidate = {
  name: 'Sam Lee',
  segment: 'industry',
  org: 'Figure AI',
  role: 'ML Engineer',
  email: 'sam@figure.ai',
  emailStatus: 'valid',
  emailConfidence: 93,
  sourceUrl: 'https://figure.ai',
  hook: 'your work as ML Engineer at Figure AI',
  focus: 'humanoid robots',
};

describe('Drafter.email', () => {
  it('produces a draft that PASSES the DraftGate (the whole point)', () => {
    const r = drafter.email(industryCandidate, 'gmail');
    expect('draft' in r).toBe(true);
    if (!('draft' in r)) return;

    const gate = new DraftGate({ linter: new StyleLinter(), snippets, isSuppressed: () => false });
    const outcome = gate.evaluate(r.draft);
    expect(outcome.decision).toBe('send');
  });

  it('quotes the personalization, the detail snippet, and the signature in the body', () => {
    const r = drafter.email(industryCandidate, 'gmail');
    if (!('draft' in r)) throw new Error('expected a draft');
    expect(r.draft.body).toContain('your work as ML Engineer at Figure AI');
    expect(r.draft.body).toContain(snippets.resolve('industry.detail')!);
    expect(r.draft.body).toContain('linkedin.com/in/parvpatodia'); // signature
    expect(r.draft.body).toContain('I have attached my resume');
    expect(r.draft.claimKeys).toEqual(['industry.intro', 'industry.detail', 'industry.coop', 'common.signature']);
  });

  it('adds a company-relevance line only when focus is known', () => {
    const withFocus = drafter.email(industryCandidate, 'gmail');
    const noFocus = drafter.email({ ...industryCandidate, focus: undefined }, 'gmail');
    if (!('draft' in withFocus) || !('draft' in noFocus)) throw new Error('expected drafts');
    expect(withFocus.draft.body).toContain('humanoid robots');
    expect(noFocus.draft.body).not.toContain("is close to what I want to build");
  });

  it('does NOT include an opt-out line', () => {
    const r = drafter.email(industryCandidate, 'gmail');
    if (!('draft' in r)) throw new Error('expected a draft');
    expect(r.draft.body.toLowerCase()).not.toContain('rather not hear from me');
  });

  it('skips a candidate with no email', () => {
    const r = drafter.email({ ...industryCandidate, email: undefined }, 'gmail');
    expect('skip' in r).toBe(true);
  });

  it('skips a segment with no approved snippets', () => {
    const r = drafter.email({ ...industryCandidate, segment: 'researcher' }, 'gmail');
    expect('skip' in r).toBe(true); // no researcher.* snippets in this book
  });
});

describe('Drafter.linkedin', () => {
  it('builds a DM with a profile link, falling back to a people search', () => {
    const dm = drafter.linkedin({ ...industryCandidate, email: undefined, linkedinUrl: undefined });
    expect(dm.message).toContain('Sam');
    expect(dm.linkedinUrl).toContain('linkedin.com/search');
  });
});
