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
import { AnswerKB } from '../../src/applier/AnswerKB.js';
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
