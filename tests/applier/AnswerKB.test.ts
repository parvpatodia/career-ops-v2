/**
 * AnswerKB: Parv's human-authored answers, the only source whose answers
 * carry humanApproved=true and may fill legal/EEO fields.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AnswerKB, CompositeAnswerSource } from '../../src/applier/AnswerKB.js';
import type { AnswerSource } from '../../src/applier/IntentPayload.js';
import type { AnswerContext } from '../../src/applier/AnswerGenerator.js';

const CTX: AnswerContext = { company: 'TestCo', role: 'MLE Intern' };

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answerkb-'));
  file = path.join(dir, 'answers.yml');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeKb(content: string): AnswerKB {
  fs.writeFileSync(file, content);
  return new AnswerKB(file);
}

describe('AnswerKB', () => {
  it('matches by normalized substring and returns a human-approved answer', () => {
    const kb = writeKb(`
answers:
  - match: ["authorized to work"]
    value: "Yes"
`);
    const a = kb.generate('Are you AUTHORIZED   to work in the United States?', CTX);
    expect(a?.value).toBe('Yes');
    expect(a?.humanApproved).toBe(true);
    expect(a?.needsReview).toBe(false);
  });

  it('first matching entry wins (specific before generic)', () => {
    const kb = writeKb(`
answers:
  - match: ["require sponsorship in the future"]
    value: "Yes"
  - match: ["require sponsorship"]
    value: "No"
`);
    expect(kb.generate('Will you require sponsorship in the future?', CTX)?.value).toBe('Yes');
    expect(kb.generate('Do you require sponsorship?', CTX)?.value).toBe('No');
  });

  it('accepts a single string for match', () => {
    const kb = writeKb(`
answers:
  - match: "graduation date"
    value: "May 2027"
`);
    expect(kb.generate('Expected Graduation Date', CTX)?.value).toBe('May 2027');
  });

  it('returns null on no match and with no file', () => {
    const kb = writeKb(`
answers:
  - match: ["start date"]
    value: "May 2026"
`);
    expect(kb.generate('Favorite sorting algorithm?', CTX)).toBeNull();

    const empty = new AnswerKB(path.join(dir, 'missing.yml'));
    expect(empty.size()).toBe(0);
    expect(empty.generate('anything', CTX)).toBeNull();
  });

  it('rejects blank values at load time', () => {
    expect(() =>
      writeKb(`
answers:
  - match: ["start date"]
    value: ""
`)
    ).toThrow(/non-empty/);
  });
});

describe('CompositeAnswerSource', () => {
  it('KB wins over the fallback; fallback fills KB gaps; null when both miss', () => {
    const kb = writeKb(`
answers:
  - match: ["start date"]
    value: "May 2026"
`);
    const fallback: AnswerSource = {
      generate: (q) =>
        q === 'Email' ? { value: 'p@x.edu', confidence: 'high', needsReview: false } : null,
    };
    const composite = new CompositeAnswerSource([kb, fallback]);

    expect(composite.generate('Earliest start date?', CTX)?.value).toBe('May 2026');
    expect(composite.generate('Earliest start date?', CTX)?.humanApproved).toBe(true);
    expect(composite.generate('Email', CTX)?.value).toBe('p@x.edu');
    expect(composite.generate('Quantum readiness?', CTX)).toBeNull();
  });
});
