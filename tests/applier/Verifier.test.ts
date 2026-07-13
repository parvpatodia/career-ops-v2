/**
 * SPEC M2 step 4: the Verifier diffs read-back reality against the
 * IntentPayload. It is pure and deterministic: byte equality for free
 * text, normalized equality for option fields, basename containment for
 * files. An intent with no read-back is a FAIL, never a pass.
 *
 * Spec deviation, stated openly: the spec mentioned an LLM judge for free
 * text. Dropped. The filler writes exact intent values, so read-back must
 * equal the intent byte-for-byte; an LLM judging equality would be a
 * subjective gate where an objective one exists (Parv's accepted
 * grounding: gates must be objective).
 */

import { describe, it, expect } from 'vitest';
import { Verifier } from '../../src/applier/Verifier.js';
import type { FieldIntent, FormField } from '../../src/applier/IntentPayload.js';

function intent(id: string, label: string, type: FormField['type'], value: string): FieldIntent {
  return {
    field: { id, label, type, required: true },
    value,
    source: 'answer-source',
    confidence: 'high',
  };
}

describe('Verifier', () => {
  const verifier = new Verifier();

  it('passes when every read-back matches the intent exactly', () => {
    const verdict = verifier.verify(
      [intent('f1', 'First Name', 'text', 'Parv'), intent('f2', 'Email', 'email', 'p@x.edu')],
      [
        { fieldId: 'f1', actual: 'Parv' },
        { fieldId: 'f2', actual: 'p@x.edu' },
      ]
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.checks.every((c) => c.pass)).toBe(true);
  });

  it('mutation test: one sabotaged value fails the whole verdict', () => {
    const verdict = verifier.verify(
      [intent('f1', 'First Name', 'text', 'Parv'), intent('f2', 'Phone', 'phone', '555-555-0142')],
      [
        { fieldId: 'f1', actual: 'Parv' },
        { fieldId: 'f2', actual: '408-401-9857' }, // one digit off
      ]
    );
    expect(verdict.pass).toBe(false);
    const failed = verdict.checks.filter((c) => !c.pass);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.fieldId).toBe('f2');
  });

  it('free text is byte-exact: trailing whitespace is a FAIL, not a shrug', () => {
    const verdict = verifier.verify(
      [intent('f1', 'Cover note', 'textarea', 'I build robots.')],
      [{ fieldId: 'f1', actual: 'I build robots. ' }]
    );
    expect(verdict.pass).toBe(false);
  });

  it('option fields compare normalized (DOM may pad option text)', () => {
    const verdict = verifier.verify(
      [intent('f1', 'Work auth', 'select', 'Yes')],
      [{ fieldId: 'f1', actual: '  Yes ' }]
    );
    expect(verdict.pass).toBe(true);
  });

  it('a typeahead select passes when the read-back is the intent plus a comma-qualifier', () => {
    // Typed "San Jose, California" -> selected "San Jose, California, United States".
    const verdict = verifier.verify(
      [intent('f1', 'Location (City)', 'select', 'San Jose, California')],
      [{ fieldId: 'f1', actual: 'San Jose, California, United States' }]
    );
    expect(verdict.pass).toBe(true);
  });

  it('the comma anchor must NOT accept a space-continuation of a different place', () => {
    // "United States" must not be satisfied by "United States Minor Outlying Islands".
    const verdict = verifier.verify(
      [intent('f1', 'Country', 'select', 'United States')],
      [{ fieldId: 'f1', actual: 'United States Minor Outlying Islands' }]
    );
    expect(verdict.pass).toBe(false);
  });

  it('a select whose display diverges entirely (dial code) still FAILS, flagged for a human', () => {
    const verdict = verifier.verify(
      [intent('f1', 'Country', 'select', 'United States')],
      [{ fieldId: 'f1', actual: '+1' }]
    );
    expect(verdict.pass).toBe(false);
  });

  it('an intent with no read-back is a FAIL (unverified is never verified)', () => {
    const verdict = verifier.verify([intent('f1', 'First Name', 'text', 'Parv')], []);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks[0]!.actual).toBeNull();
  });

  it('a null read-back (field unreadable or empty) is a FAIL', () => {
    const verdict = verifier.verify(
      [intent('f1', 'First Name', 'text', 'Parv')],
      [{ fieldId: 'f1', actual: null }]
    );
    expect(verdict.pass).toBe(false);
  });

  it('checkbox: a checked box ("Yes") matches an affirmative intent ("I agree")', () => {
    const verdict = verifier.verify(
      [intent('f1', 'I agree to the terms', 'checkbox', 'I agree')],
      [{ fieldId: 'f1', actual: 'Yes' }]
    );
    expect(verdict.pass).toBe(true);
  });

  it('checkbox: an unchecked box ("No") fails an affirmative intent', () => {
    const verdict = verifier.verify(
      [intent('f1', 'I agree to the terms', 'checkbox', 'I agree')],
      [{ fieldId: 'f1', actual: 'No' }]
    );
    expect(verdict.pass).toBe(false);
  });

  it('file fields pass when the read-back contains the uploaded basename', () => {
    const verdict = verifier.verify(
      [intent('f1', 'Resume', 'file', '/Users/x/output/resumes/parv-ai.pdf')],
      [{ fieldId: 'f1', actual: 'parv-ai.pdf' }]
    );
    expect(verdict.pass).toBe(true);
  });

  it('file fields fail on a different filename', () => {
    const verdict = verifier.verify(
      [intent('f1', 'Resume', 'file', '/Users/x/output/resumes/parv-ai.pdf')],
      [{ fieldId: 'f1', actual: 'parv-ml.pdf' }]
    );
    expect(verdict.pass).toBe(false);
  });

  it('extra read-backs for unknown fields are ignored', () => {
    const verdict = verifier.verify(
      [intent('f1', 'First Name', 'text', 'Parv')],
      [
        { fieldId: 'f1', actual: 'Parv' },
        { fieldId: 'ghost', actual: 'whatever' },
      ]
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.checks).toHaveLength(1);
  });
});
