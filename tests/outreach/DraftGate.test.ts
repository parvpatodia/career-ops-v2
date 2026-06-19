import { describe, it, expect } from 'vitest';
import { DraftGate } from '../../src/outreach/DraftGate.js';
import { StyleLinter } from '../../src/outreach/StyleLinter.js';
import { SnippetBook } from '../../src/outreach/SnippetBook.js';
import { contactIdForEmail } from '../../src/outreach/events.js';
import type { EmailDraft } from '../../src/outreach/types.js';

const SNIPPET = "I'm a master's student in AI at Northeastern working on diffusion policy for robot manipulation.";
const snippets = new SnippetBook({ 'researcher.intro': SNIPPET });
const linter = new StyleLinter();

function gate(isSuppressed: (id: string) => boolean = () => false): DraftGate {
  return new DraftGate({ linter, snippets, isSuppressed });
}

function validDraft(over: Partial<EmailDraft> = {}): EmailDraft {
  const personalization = 'I read your RSS 2025 paper on multimodal diffusion planners.';
  return {
    contactId: contactIdForEmail('alex@stanford.edu'),
    to: 'alex@stanford.edu',
    fromAccount: 'gmail',
    subject: 'Question about your diffusion planner',
    body: `Hi Alex,\n\n${personalization}\n\n${SNIPPET}\n\nWould you have 15 minutes to chat?\n\nParv`,
    segment: 'researcher',
    personalization,
    sourceUrl: 'https://arxiv.org/abs/2505.00001',
    claimKeys: ['researcher.intro'],
    emailStatus: 'valid',
    emailConfidence: 95,
    ...over,
  };
}

describe('DraftGate', () => {
  it('passes a fully grounded, verified, clean, personalized draft', () => {
    const out = gate().evaluate(validDraft());
    expect(out.decision).toBe('send');
  });

  it('abstains a suppressed contact', () => {
    const out = gate(() => true).evaluate(validDraft());
    expect(out.decision).toBe('abstain');
    if (out.decision === 'abstain') expect(out.reasons.join(' ')).toMatch(/suppressed/);
  });

  it('abstains when the email is not Hunter-valid', () => {
    for (const status of ['accept_all', 'unknown', 'webmail', 'invalid'] as const) {
      const out = gate().evaluate(validDraft({ emailStatus: status }));
      expect(out.decision).toBe('abstain');
    }
  });

  it('abstains on an AI-tell or em dash in the body', () => {
    const out = gate().evaluate(validDraft({ body: validDraft().body + '\nI would love to leverage your insight.' }));
    expect(out.decision).toBe('abstain');
    if (out.decision === 'abstain') expect(out.reasons.join(' ')).toMatch(/style/);
  });

  it('abstains when personalization is empty or absent from the body', () => {
    expect(gate().evaluate(validDraft({ personalization: '   ' })).decision).toBe('abstain');
    const out = gate().evaluate(validDraft({ personalization: 'a hook never written into the email' }));
    expect(out.decision).toBe('abstain');
    if (out.decision === 'abstain') expect(out.reasons.join(' ')).toMatch(/not present in the body/);
  });

  it('abstains a draft with zero claims (no vacuous pass)', () => {
    const out = gate().evaluate(validDraft({ claimKeys: [] }));
    expect(out.decision).toBe('abstain');
    if (out.decision === 'abstain') expect(out.reasons.join(' ')).toMatch(/zero grounded claims/);
  });

  it('abstains on an unknown claim key or a claim not quoted in the body', () => {
    expect(gate().evaluate(validDraft({ claimKeys: ['researcher.nope'] })).decision).toBe('abstain');
    // claim key resolves, but the snippet text is not in the body
    const out = gate().evaluate(validDraft({ body: 'Hi Alex,\nI read your RSS 2025 paper on multimodal diffusion planners.\nThanks,\nParv' }));
    expect(out.decision).toBe('abstain');
    if (out.decision === 'abstain') expect(out.reasons.join(' ')).toMatch(/not quoted in the body/);
  });
});
