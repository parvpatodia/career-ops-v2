/**
 * ApplicationAdapter resilience: a DOM interaction that THROWS during fill or
 * read-back (a flaky page, a hidden/detached element, a Playwright timeout) must
 * resolve to verify_failed — never propagate and crash the batch loop. This is
 * the verify-or-abstain contract at its strongest: a fill we cannot complete is
 * a fill we cannot verify, so nothing is submitted and the loop continues.
 * Regression for the 2026-07-12 crash (Blue River: scrollIntoViewIfNeeded
 * timeout in GenericFormSource.fill killed the whole `npm run run` batch).
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

const schema: NormalizedSchema = { fields: FIELDS, eeo: [], unmapped: [] };
const ctx: AnswerContext = { company: 'Globex', role: 'ML Intern' };

class ThrowingFillSource implements AtsFormSource {
  readonly ats = 'generic';
  async isAuthWall(): Promise<boolean> { return false; }
  async scanSchema(): Promise<NormalizedSchema> { return schema; }
  async fill(): Promise<void> { throw new Error('locator.scrollIntoViewIfNeeded: Timeout 5000ms exceeded'); }
  async readBack(): Promise<string | null> { return null; }
}

class ThrowingReadBackSource implements AtsFormSource {
  readonly ats = 'generic';
  filled: FieldIntent[] = [];
  async isAuthWall(): Promise<boolean> { return false; }
  async scanSchema(): Promise<NormalizedSchema> { return schema; }
  async fill(intent: FieldIntent): Promise<void> { this.filled.push(intent); }
  async readBack(): Promise<string | null> { throw new Error('element is not attached to the DOM'); }
}

describe('ApplicationAdapter resilience to a thrown DOM interaction', () => {
  it('returns verify_failed (does NOT throw) when fill() throws', async () => {
    const outcome = await new ApplicationAdapter(new ThrowingFillSource(), answers).run(ctx);
    expect(outcome.kind).toBe('verify_failed');
    if (outcome.kind === 'verify_failed') {
      expect(outcome.verdict.pass).toBe(false);
      // The error is surfaced in the verdict so the human sees WHY it failed.
      expect(outcome.verdict.checks.every((c) => !c.pass)).toBe(true);
      expect(String(outcome.verdict.checks[0]!.actual)).toContain('fill error');
    }
  });

  it('returns verify_failed (does NOT throw) when readBack() throws', async () => {
    const outcome = await new ApplicationAdapter(new ThrowingReadBackSource(), answers).run(ctx);
    expect(outcome.kind).toBe('verify_failed');
    if (outcome.kind === 'verify_failed') expect(outcome.verdict.pass).toBe(false);
  });
});
