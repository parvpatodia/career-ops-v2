/**
 * AttendedFiller: partial fill + per-field verify + handoff, no submit. Fake
 * AtsFormSource + AnswerSource (no browser). Accuracy: only known fields are
 * filled, each is verified, a read-back mismatch is flagged, the rest is the
 * human's.
 */

import { describe, it, expect } from 'vitest';
import { AttendedFiller } from '../../src/applier/AttendedFiller.js';
import type { AtsFormSource, NormalizedSchema } from '../../src/applier/ApplicationAdapter.js';
import type { FieldIntent, FormField, AnswerSource } from '../../src/applier/IntentPayload.js';
import type { Answer, AnswerContext } from '../../src/applier/AnswerGenerator.js';

const SCHEMA: NormalizedSchema = {
  fields: [
    { id: 'first_name', label: 'First Name', type: 'text', required: true },
    { id: 'email', label: 'Email', type: 'email', required: true },
    { id: 'why', label: 'Why do you want to work here?', type: 'textarea', required: true },
  ],
  eeo: [{ id: 'gender', label: 'Gender' }],
  unmapped: [{ id: 'term', label: 'Which terms?', required: true, widget: 'radio' }],
};

const ANSWERS: Record<string, string> = { 'first name': 'Ada', email: 'ada@example.com' };
const answers: AnswerSource = {
  generate(q: string): Answer | null {
    const key = q.toLowerCase().trim();
    for (const [k, v] of Object.entries(ANSWERS)) if (key.includes(k)) return { value: v, confidence: 'high', needsReview: false };
    return null; // "Why do you want to work here?" -> unknown
  },
};

class FakeSource implements AtsFormSource {
  readonly ats = 'generic';
  filled: FieldIntent[] = [];
  constructor(private readonly authWall = false, private readonly readMap: Record<string, string | null> = {}) {}
  async isAuthWall(): Promise<boolean> { return this.authWall; }
  async scanSchema(): Promise<NormalizedSchema> { return SCHEMA; }
  async fill(intent: FieldIntent): Promise<void> { this.filled.push(intent); }
  async readBack(field: FormField): Promise<string | null> {
    return field.id in this.readMap ? this.readMap[field.id]! : ANSWERS[field.label.toLowerCase()] ?? null;
  }
}

const ctx: AnswerContext = { company: 'Globex', role: 'ML Intern' };

describe('AttendedFiller', () => {
  it('fills only known fields, verifies them, hands off unknown/EEO/unmapped', async () => {
    const src = new FakeSource(); // read-back echoes the filled value -> verified
    const r = await new AttendedFiller(src, answers).fill(ctx);

    if (r.kind !== 'filled') throw new Error('expected filled');
    // Only the two known fields were filled (NOT the unknown essay).
    expect(src.filled.map((f) => f.field.id).sort()).toEqual(['email', 'first_name']);
    expect(r.verified.map((f) => f.label).sort()).toEqual(['Email', 'First Name']);
    expect(r.verifyFailed).toHaveLength(0);
    // The unknown question + EEO + required radio are handed to the human.
    const human = r.needsHuman.map((h) => h.label);
    expect(human).toContain('Why do you want to work here?');
    expect(human).toContain('Gender');
    expect(human).toContain('Which terms?');
  });

  it('flags a filled field whose read-back does not match (never claims it correct)', async () => {
    // Email reads back wrong -> verifyFailed, not verified.
    const src = new FakeSource(false, { email: 'WRONG@x.com' });
    const r = await new AttendedFiller(src, answers).fill(ctx);
    if (r.kind !== 'filled') throw new Error('expected filled');
    expect(r.verified.map((f) => f.label)).toEqual(['First Name']);
    expect(r.verifyFailed.map((f) => f.label)).toEqual(['Email']);
  });

  it('reports auth_required at a login wall (fills nothing)', async () => {
    const src = new FakeSource(true);
    const r = await new AttendedFiller(src, answers).fill(ctx);
    expect(r.kind).toBe('auth_required');
    expect(src.filled).toHaveLength(0);
  });
});
