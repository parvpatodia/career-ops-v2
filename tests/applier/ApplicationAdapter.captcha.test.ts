/**
 * ApplicationAdapter captcha routing: a captcha is a designed human touchpoint
 * (invariant 6). The autonomous, all-or-nothing path must hand off to a human
 * (auth_required) BEFORE any fill — never fill then blind-submit into a wall it
 * cannot pass. Fake source (no browser).
 */

import { describe, it, expect } from 'vitest';
import { ApplicationAdapter } from '../../src/applier/ApplicationAdapter.js';
import type { AtsFormSource, NormalizedSchema } from '../../src/applier/ApplicationAdapter.js';
import type { FieldIntent, FormField, AnswerSource } from '../../src/applier/IntentPayload.js';
import type { Answer, AnswerContext } from '../../src/applier/AnswerGenerator.js';

const FIELDS: FormField[] = [
  { id: 'first_name', label: 'First Name', type: 'text', required: true },
  { id: 'email', label: 'Email', type: 'email', required: true },
];

const answers: AnswerSource = {
  generate(q: string): Answer | null {
    const k = q.toLowerCase();
    if (k.includes('first name')) return { value: 'Ada', confidence: 'high', needsReview: false };
    if (k.includes('email')) return { value: 'ada@example.com', confidence: 'high', needsReview: false };
    return null;
  },
};

class FakeSource implements AtsFormSource {
  readonly ats = 'generic';
  filled: FieldIntent[] = [];
  constructor(private readonly schema: NormalizedSchema) {}
  async isAuthWall(): Promise<boolean> { return false; }
  async scanSchema(): Promise<NormalizedSchema> { return this.schema; }
  async fill(intent: FieldIntent): Promise<void> { this.filled.push(intent); }
  async readBack(field: FormField): Promise<string | null> {
    // Echo the intended value so, absent a captcha, the form verifies green.
    return this.filled.find((i) => i.field.id === field.id)?.value ?? null;
  }
}

const ctx: AnswerContext = { company: 'Globex', role: 'ML Intern' };

describe('ApplicationAdapter captcha routing', () => {
  it('returns auth_required and fills NOTHING when a captcha is present', async () => {
    const src = new FakeSource({ fields: FIELDS, eeo: [], unmapped: [], captcha: { kind: 'recaptcha' } });
    const outcome = await new ApplicationAdapter(src, answers).run(ctx);
    expect(outcome.kind).toBe('auth_required');
    expect(src.filled).toHaveLength(0); // never touched the form
  });

  it('verifies green when the same form has no captcha', async () => {
    const src = new FakeSource({ fields: FIELDS, eeo: [], unmapped: [] });
    const outcome = await new ApplicationAdapter(src, answers).run(ctx);
    expect(outcome.kind).toBe('verified');
    expect(src.filled.map((f) => f.field.id).sort()).toEqual(['email', 'first_name']);
  });
});
