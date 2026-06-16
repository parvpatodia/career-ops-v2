/**
 * SPEC M3.5: the self-improving coverage loop. An unknown question is flagged
 * (deduped), and once resolved it lands in the learned AnswerKB file so the
 * same question is answered forever after. This is how human intervention
 * trends to zero.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AnswerInbox } from '../../src/applier/AnswerInbox.js';
import { AnswerKB, CompositeAnswerSource } from '../../src/applier/AnswerKB.js';
import type { AnswerSource } from '../../src/applier/IntentPayload.js';
import type { AnswerContext } from '../../src/applier/AnswerGenerator.js';

const CTX: AnswerContext = { company: 'NVIDIA', role: 'ML Intern' };
const Q = 'What is your favorite tensor library?';

let dir: string;
let pending: string;
let learned: string;
let inbox: AnswerInbox;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
  pending = path.join(dir, 'pending.json');
  learned = path.join(dir, 'answers.learned.yml');
  inbox = new AnswerInbox(pending, learned);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('AnswerInbox', () => {
  it('flags an unknown question with context', () => {
    const entry = inbox.flag(Q, CTX, 'no known answer');
    expect(entry).not.toBeNull();
    expect(entry!.company).toBe('NVIDIA');
    expect(inbox.listPending()).toHaveLength(1);
    expect(inbox.listPending()[0]!.label).toBe(Q);
  });

  it('dedupes the same question (case/whitespace-insensitive)', () => {
    inbox.flag(Q, CTX, 'no known answer');
    const second = inbox.flag('  WHAT IS your   favorite tensor library? ', CTX, 'no known answer');
    expect(second).toBeNull();
    expect(inbox.listPending()).toHaveLength(1);
  });

  it('resolve teaches the learned AnswerKB and clears the inbox entry', () => {
    inbox.flag(Q, CTX, 'no known answer');
    inbox.resolve(Q, 'PyTorch');

    expect(inbox.listPending()).toHaveLength(0);

    // A fresh AnswerKB over the learned file now answers the question,
    // human-approved (so it could even open the legal/EEO gate).
    const kb = new AnswerKB(learned);
    const answer = kb.generate(Q, CTX);
    expect(answer?.value).toBe('PyTorch');
    expect(answer?.humanApproved).toBe(true);
  });

  it('a resolved question is no longer flagged on a later run (never unknown twice)', () => {
    inbox.flag(Q, CTX, 'no known answer');
    inbox.resolve(Q, 'PyTorch');
    const reflag = inbox.flag(Q, CTX, 'no known answer');
    expect(reflag).toBeNull();
    expect(inbox.listPending()).toHaveLength(0);
  });

  it('rejects an empty resolve value (would blank a field with full confidence)', () => {
    inbox.flag(Q, CTX, 'no known answer');
    expect(() => inbox.resolve(Q, '   ')).toThrow(/non-empty/i);
  });

  it('survives a corrupt pending file without crashing', () => {
    fs.writeFileSync(pending, '{ not valid json');
    expect(inbox.listPending()).toEqual([]);
    expect(inbox.flag(Q, CTX, 'why')).not.toBeNull();
  });
});

/**
 * Regression for LESSONS.md 2026-06-16: the M4 batch/CLI loop holds ONE
 * long-lived CompositeAnswerSource across resume iterations (unlike the demo,
 * which rebuilds the adapter per pass). AnswerKB caches its file at
 * construction, so without reload the loop re-abstains on the just-resolved
 * question forever (an infinite needs_input loop). The fix: reload after
 * resolve, before the next run.
 */
describe('M4 resume loop: long-lived answer source picks up a mid-loop resolve', () => {
  // An in-memory identity source, exactly as the demo/M4 wires alongside the KB.
  const identity: AnswerSource = {
    generate: (q) =>
      q.toLowerCase().includes('email')
        ? { value: 'p@x.edu', confidence: 'high', needsReview: false }
        : null,
  };

  it('reload after resolve lets the next run answer; without reload it would loop', () => {
    // Built ONCE and reused, the way the batch loop would hold it. The learned
    // KB is a single instance, not a fresh inbox.learnedSource() per pass.
    const answers = new CompositeAnswerSource([inbox.learnedSource(), identity]);

    // RUN 1: the question is unknown -> the loop flags it and would stop at
    // needs_input. The identity source still answers what it owns.
    expect(answers.generate(Q, CTX)).toBeNull();
    expect(answers.generate('Email', CTX)?.value).toBe('p@x.edu');
    inbox.flag(Q, CTX, 'no known answer');

    // Parv answers the notification mid-loop.
    inbox.resolve(Q, 'PyTorch');

    // Without reload, the cached KB has NOT seen the new answer: this is the
    // infinite-loop trap the fix prevents.
    expect(answers.generate(Q, CTX)).toBeNull();

    // The single call the M4 loop makes after resolve.
    answers.reload();

    // RUN 2: the same source now answers, human-approved (could even open the
    // legal/EEO gate), and the unrelated identity answer is untouched.
    const a = answers.generate(Q, CTX);
    expect(a?.value).toBe('PyTorch');
    expect(a?.humanApproved).toBe(true);
    expect(answers.generate('Email', CTX)?.value).toBe('p@x.edu');
  });
});
