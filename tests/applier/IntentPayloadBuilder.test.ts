/**
 * SPEC M2 step 2: the IntentPayload is the exact list of intended values,
 * built before any browser opens. The Verifier later diffs reality against
 * it. Core property: verify-or-abstain begins here; nothing uncertain
 * reaches the fill stage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IntentPayloadBuilder } from '../../src/applier/IntentPayload.js';
import type { FormField, AnswerSource } from '../../src/applier/IntentPayload.js';
import type { Answer, AnswerContext } from '../../src/applier/AnswerGenerator.js';

const CTX: AnswerContext = { company: 'TestCo', role: 'MLE Intern' };

function hi(value: string): Answer {
  return { value, confidence: 'high', needsReview: false };
}

function med(value: string, reason: string): Answer {
  return { value, confidence: 'medium', needsReview: true, reason };
}

/** Deterministic stub: answers by exact label lookup, null otherwise. */
function stub(answers: Record<string, Answer>): AnswerSource {
  return { generate: (q) => answers[q] ?? null };
}

function text(id: string, label: string, required = true): FormField {
  return { id, label, type: 'text', required };
}

function select(id: string, label: string, options: string[], required = true): FormField {
  return { id, label, type: 'select', required, options };
}

describe('IntentPayloadBuilder', () => {
  it('builds a ready payload from known high-confidence answers', () => {
    const builder = new IntentPayloadBuilder(
      stub({
        'First Name': hi('Parv'),
        'Email': hi('p@x.edu'),
        'Are you authorized to work in the US?': hi('Yes'),
      })
    );
    const result = builder.build(
      [
        text('f1', 'First Name'),
        text('f2', 'Email'),
        select('f3', 'Are you authorized to work in the US?', ['Yes', 'No']),
      ],
      CTX
    );

    expect(result.kind).toBe('ready');
    expect(result.intents).toHaveLength(3);
    expect(result.reasons).toHaveLength(0);
    expect(result.intents.find((i) => i.field.id === 'f3')?.value).toBe('Yes');
  });

  it('abstains on a required unknown question, keeping the known intents visible', () => {
    const builder = new IntentPayloadBuilder(stub({ 'First Name': hi('Parv') }));
    const result = builder.build(
      [text('f1', 'First Name'), text('f2', 'Explain your favorite distributed system')],
      CTX
    );

    expect(result.kind).toBe('abstain');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]!.label).toContain('distributed system');
    expect(result.intents).toHaveLength(1);
  });

  it('skips an optional unknown question and stays ready', () => {
    const builder = new IntentPayloadBuilder(stub({ 'First Name': hi('Parv') }));
    const result = builder.build(
      [text('f1', 'First Name'), text('f2', 'Anything else to share?', false)],
      CTX
    );

    expect(result.kind).toBe('ready');
    expect(result.skipped.map((f) => f.id)).toEqual(['f2']);
  });

  it('abstains on a select near-miss instead of guessing (v1 first-option regression)', () => {
    const builder = new IntentPayloadBuilder(stub({ 'State': hi('CA') }));
    const result = builder.build([select('f1', 'State', ['California', 'Canada'])], CTX);

    expect(result.kind).toBe('abstain');
    expect(result.intents).toHaveLength(0); // never the first option
    expect(result.reasons[0]!.why).toMatch(/no exact option match/i);
  });

  it('abstains when two options normalize to the same answer (ambiguity)', () => {
    const builder = new IntentPayloadBuilder(stub({ 'Degree': hi('masters') }));
    const result = builder.build([select('f1', 'Degree', ['Masters', ' MASTERS '])], CTX);

    expect(result.kind).toBe('abstain');
    expect(result.reasons[0]!.why).toMatch(/ambiguous/i);
  });

  it('abstains on any needsReview answer', () => {
    const builder = new IntentPayloadBuilder(
      stub({ 'Desired salary': med('45/hr', 'compensation needs human review') })
    );
    const result = builder.build([text('f1', 'Desired salary')], CTX);

    expect(result.kind).toBe('abstain');
    expect(result.reasons[0]!.why).toMatch(/needs review/i);
  });

  it('force-abstains on legal/EEO questions even when the answer source is confident', () => {
    const builder = new IntentPayloadBuilder(
      stub({ 'Do you have a disability?': hi('I do not have a disability') })
    );
    const result = builder.build([text('f1', 'Do you have a disability?')], CTX);

    expect(result.kind).toBe('abstain');
    expect(result.reasons[0]!.why).toMatch(/human-approved/i);
    expect(result.intents).toHaveLength(0);
  });

  it('accepts a human-approved answer on a legal/EEO question (the AnswerKB path)', () => {
    const approved: Answer = {
      value: 'I do not wish to answer',
      confidence: 'high',
      needsReview: false,
      humanApproved: true,
    };
    const builder = new IntentPayloadBuilder(stub({ 'Do you have a disability?': approved }));
    const result = builder.build([text('f1', 'Do you have a disability?')], CTX);

    expect(result.kind).toBe('ready');
    expect(result.intents[0]!.value).toBe('I do not wish to answer');
  });

  it('skips optional legal/EEO questions silently (blank is the safe answer)', () => {
    const builder = new IntentPayloadBuilder(
      stub({ 'Veteran status': hi('I am not a protected veteran') })
    );
    const result = builder.build([text('f1', 'Veteran status', false)], CTX);

    expect(result.kind).toBe('ready');
    expect(result.intents).toHaveLength(0);
    expect(result.skipped.map((f) => f.id)).toEqual(['f1']);
  });

  it('fills an OPTIONAL EEO select when a human-approved answer matches an option exactly', () => {
    const approved = (v: string): Answer => ({ value: v, confidence: 'high', needsReview: false, humanApproved: true });
    const builder = new IntentPayloadBuilder(stub({ Gender: approved('Male') }));
    const result = builder.build([select('f1', 'Gender', ['Decline To Self Identify', 'Female', 'Male'], false)], CTX);

    expect(result.kind).toBe('ready');
    expect(result.intents.find((i) => i.field.id === 'f1')?.value).toBe('Male');
  });

  it('SKIPS an optional option-field whose approved answer matches no option (blank, never a whole-form blocker)', () => {
    const approved = (v: string): Answer => ({ value: v, confidence: 'high', needsReview: false, humanApproved: true });
    const builder = new IntentPayloadBuilder(stub({ 'Disability Status': approved('I do not have a disability') }));
    const result = builder.build(
      [select('f1', 'Disability Status', ['I do not want to answer', 'No, I do not have a disability and have not had one in the past', 'Yes, I have a disability'], false)],
      CTX
    );

    expect(result.kind).toBe('ready'); // did NOT abstain the whole form
    expect(result.intents).toHaveLength(0);
    expect(result.skipped.map((f) => f.id)).toEqual(['f1']);
  });

  it('a REQUIRED option-field near-miss STILL abstains (safety unchanged)', () => {
    const approved = (v: string): Answer => ({ value: v, confidence: 'high', needsReview: false, humanApproved: true });
    const builder = new IntentPayloadBuilder(stub({ 'Disability Status': approved('I do not have a disability') }));
    const result = builder.build(
      [select('f1', 'Disability Status', ['No, I do not have a disability and have not had one in the past', 'Yes, I have a disability'], true)],
      CTX
    );

    expect(result.kind).toBe('abstain');
    expect(result.reasons).toHaveLength(1);
  });

  describe('resume file field', () => {
    let dir: string;
    let pdf: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-'));
      pdf = path.join(dir, 'resume.pdf');
      fs.writeFileSync(pdf, 'fake pdf bytes');
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('attaches an existing resume PDF as a resume-file intent', () => {
      const builder = new IntentPayloadBuilder(stub({}));
      const field: FormField = { id: 'r1', label: 'Resume', type: 'file', required: true };
      const result = builder.build([field], CTX, pdf);

      expect(result.kind).toBe('ready');
      expect(result.intents[0]!.source).toBe('resume-file');
      expect(result.intents[0]!.value).toBe(pdf);
    });

    it('abstains when a required resume file is missing on disk', () => {
      const builder = new IntentPayloadBuilder(stub({}));
      const field: FormField = { id: 'r1', label: 'Resume', type: 'file', required: true };
      const result = builder.build([field], CTX, path.join(dir, 'nope.pdf'));

      expect(result.kind).toBe('abstain');
      expect(result.reasons[0]!.why).toMatch(/missing/i);
    });
  });
});
