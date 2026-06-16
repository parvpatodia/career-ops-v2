/**
 * SPEC M3.5: the Autopilot loop. Tested with fakes for the fill+verify step and
 * the submit surface, a dry-run notifier, and temp inbox/store/recorder.
 *
 * Properties under test:
 * - abstained -> flag every unknown + notify, STOP at needs_input, never submit;
 * - resume: after the inbox is taught, a second run reaches verified;
 * - verified without approval -> ready_to_submit, never submit;
 * - verified WITH approval -> submit once, write a receipt, notify;
 * - idempotency: a submitted app is never submitted again;
 * - verify_failed / auth_required -> notify, never submit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Autopilot } from '../../src/applier/Autopilot.js';
import type { FillVerifyStep, SubmitDriver, BatchApproval, JobRef } from '../../src/applier/Autopilot.js';
import type { WorkdayOutcome } from '../../src/applier/WorkdayAdapter.js';
import type { FieldIntent } from '../../src/applier/IntentPayload.js';
import type { VerifierVerdict } from '../../src/applier/Verifier.js';
import { Notifier } from '../../src/applier/Notifier.js';
import type { Notification } from '../../src/applier/Notifier.js';
import { AnswerInbox } from '../../src/applier/AnswerInbox.js';
import { EventStore } from '../../src/store/EventStore.js';
import { SubmissionRecorder } from '../../src/applier/SubmissionRecorder.js';
import { appIdFor } from '../../src/store/events.js';
import type { AnswerContext } from '../../src/applier/AnswerGenerator.js';

const CTX: AnswerContext = { company: 'NVIDIA', role: 'ML Intern' };
const APPROVAL: BatchApproval = { approvedBy: 'parv', approvedAt: '2026-06-16T00:00:00Z' };

function intent(id: string, label: string, value: string): FieldIntent {
  return { field: { id, label, type: 'text', required: true }, value, source: 'answer-source', confidence: 'high' };
}

const VERIFIED: WorkdayOutcome = {
  kind: 'verified',
  verdict: { pass: true, checks: [{ fieldId: 'f1', label: 'First Name', expected: 'Parv', actual: 'Parv', pass: true }] },
  intents: [intent('f1', 'First Name', 'Parv')],
  skipped: [],
  eeo: [],
  unmapped: [],
};

const ABSTAINED: WorkdayOutcome = {
  kind: 'abstained',
  reasons: [{ fieldId: 'q1', label: 'Why this team?', why: 'no known answer (unknown question)' }],
  eeo: [],
  unmapped: [],
};

const VERIFY_FAILED: WorkdayOutcome = {
  kind: 'verify_failed',
  verdict: { pass: false, checks: [{ fieldId: 'f1', label: 'First Name', expected: 'Parv', actual: 'Parvv', pass: false }] },
  intents: [intent('f1', 'First Name', 'Parv')],
  eeo: [],
};

class FakeFill implements FillVerifyStep {
  runCount = 0;
  constructor(private readonly outcomes: WorkdayOutcome[]) {}
  async run(): Promise<WorkdayOutcome> {
    const o = this.outcomes[Math.min(this.runCount, this.outcomes.length - 1)]!;
    this.runCount++;
    return o;
  }
}

class FakeSubmit implements SubmitDriver {
  clickCount = 0;
  constructor(private readonly confirmation: string | null = 'WD-CONF-123') {}
  async clickSubmit(): Promise<void> {
    this.clickCount++;
  }
  async readConfirmation(): Promise<string | null> {
    return this.confirmation;
  }
}

let dir: string;
let store: EventStore;
let recorder: SubmissionRecorder;
let inbox: AnswerInbox;
let sent: Notification[];
let notifier: Notifier;

const JOB: JobRef = { appId: appIdFor('NVIDIA', 'ML Intern'), company: 'NVIDIA', role: 'ML Intern', screenshotPaths: ['/tmp/a.png'] };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-'));
  store = new EventStore(path.join(dir, 'events.jsonl'));
  recorder = new SubmissionRecorder(store, path.join(dir, 'receipts'));
  inbox = new AnswerInbox(path.join(dir, 'pending.json'), path.join(dir, 'learned.yml'));
  sent = [];
  notifier = new Notifier((n) => sent.push(n));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function make(outcomes: WorkdayOutcome[], submit = new FakeSubmit()) {
  const fill = new FakeFill(outcomes);
  const pilot = new Autopilot({ adapter: fill, submit, notifier, inbox, store, recorder });
  return { pilot, fill, submit };
}

function eventTypes(): string[] {
  return store.readAll().events.map((e) => e.type);
}

describe('Autopilot', () => {
  it('abstained: flags the unknown, notifies, STOPS at needs_input, never submits', async () => {
    const { pilot, submit } = make([ABSTAINED]);
    const result = await pilot.run(CTX, JOB);

    expect(result.phase).toBe('needs_input');
    if (result.phase === 'needs_input') expect(result.pending).toHaveLength(1);
    expect(inbox.listPending()).toHaveLength(1);
    expect(sent.some((n) => n.kind === 'unknown_question')).toBe(true);
    expect(eventTypes()).toContain('abstained');
    expect(submit.clickCount).toBe(0);
    expect(eventTypes()).not.toContain('submitted');
  });

  it('resume: after the inbox is taught, a later approved run submits', async () => {
    const { pilot, submit } = make([ABSTAINED, VERIFIED]);

    const first = await pilot.run(CTX, JOB);
    expect(first.phase).toBe('needs_input');

    // Parv answers the flagged question (the notification touchpoint).
    inbox.resolve('Why this team?', 'Your work on robotics foundation models.');

    const second = await pilot.run(CTX, JOB, APPROVAL);
    expect(second.phase).toBe('submitted');
    expect(submit.clickCount).toBe(1);
    expect(eventTypes()).toEqual(['abstained', 'fill_verified', 'submitted', 'confirmed']);
  });

  it('verified without approval: ready_to_submit, never submits', async () => {
    const { pilot, submit } = make([VERIFIED]);
    const result = await pilot.run(CTX, JOB);

    expect(result.phase).toBe('ready_to_submit');
    expect(eventTypes()).toEqual(['fill_verified']);
    expect(submit.clickCount).toBe(0);
    expect(eventTypes()).not.toContain('submitted');
  });

  it('verified WITH approval: submits once, writes a receipt with the confirmation, notifies', async () => {
    const { pilot, submit } = make([VERIFIED]);
    const result = await pilot.run(CTX, JOB, APPROVAL);

    expect(result.phase).toBe('submitted');
    if (result.phase === 'submitted') {
      expect(result.receipt.atsConfirmation).toBe('WD-CONF-123');
      expect(result.receipt.fields).toEqual([{ label: 'First Name', value: 'Parv' }]);
    }
    expect(submit.clickCount).toBe(1);
    expect(eventTypes()).toEqual(['fill_verified', 'submitted', 'confirmed']);
    expect(sent.some((n) => n.kind === 'batch_complete')).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'receipts'))).toHaveLength(1);
  });

  it('idempotency: a submitted application is never submitted again', async () => {
    const first = make([VERIFIED]);
    await first.pilot.run(CTX, JOB, APPROVAL);
    expect(first.submit.clickCount).toBe(1);

    // A fresh run for the same appId (e.g. the batch is re-run).
    const second = make([VERIFIED]);
    const result = await second.pilot.run(CTX, JOB, APPROVAL);

    expect(result.phase).toBe('already_submitted');
    expect(second.submit.clickCount).toBe(0); // form never re-touched
    expect(fs.readdirSync(path.join(dir, 'receipts'))).toHaveLength(1); // no duplicate receipt
  });

  it('verify_failed: records fill_verified(pass:false), notifies, never submits', async () => {
    const { pilot, submit } = make([VERIFY_FAILED]);
    const result = await pilot.run(CTX, JOB, APPROVAL);

    expect(result.phase).toBe('verify_failed');
    expect(submit.clickCount).toBe(0);
    expect(eventTypes()).not.toContain('submitted');
    const fv = store.readAll().events.find((e) => e.type === 'fill_verified');
    expect(fv?.payload.pass).toBe(false);
    expect(sent.some((n) => n.kind === 'abstain')).toBe(true);
  });

  it('auth_required: notifies, never submits', async () => {
    const { pilot, submit } = make([{ kind: 'auth_required' }]);
    const result = await pilot.run(CTX, JOB, APPROVAL);

    expect(result.phase).toBe('auth_required');
    expect(submit.clickCount).toBe(0);
    expect(eventTypes()).not.toContain('submitted');
    expect(sent.some((n) => n.kind === 'captcha')).toBe(true);
  });
});
