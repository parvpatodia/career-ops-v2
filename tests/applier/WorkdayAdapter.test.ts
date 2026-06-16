/**
 * SPEC M3: the WorkdayAdapter wires the pure verify-or-abstain pipeline to a
 * page driver. Tested against a FAKE driver (an in-memory "DOM") so the
 * orchestration is verifiable without a browser.
 *
 * Core properties under test:
 * - verified only when an independent read-back matches the payload;
 * - a sabotaged read-back fails the verdict (the maker/checker split works);
 * - an uncertain form abstains BEFORE the first fill (no browser mutation);
 * - EEO fields are surfaced, never filled;
 * - an auth wall stops before scanning;
 * - NO path ever writes a `submitted` event.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WorkdayAdapter } from '../../src/applier/WorkdayAdapter.js';
import type { WorkdayPageDriver } from '../../src/applier/WorkdayAdapter.js';
import type { WorkdayRawField } from '../../src/applier/WorkdaySchemaMapper.js';
import type { FieldIntent, FormField, AnswerSource } from '../../src/applier/IntentPayload.js';
import type { Answer, AnswerContext } from '../../src/applier/AnswerGenerator.js';
import { EventStore } from '../../src/store/EventStore.js';
import { SubmissionRecorder } from '../../src/applier/SubmissionRecorder.js';
import { appIdFor } from '../../src/store/events.js';

const CTX: AnswerContext = { company: 'Workday Co', role: 'MLE Intern' };
const APP_ID = appIdFor('Workday Co', 'MLE Intern');

function hi(value: string): Answer {
  return { value, confidence: 'high', needsReview: false };
}

function stub(answers: Record<string, Answer>): AnswerSource {
  return { generate: (q) => answers[q] ?? null };
}

function raw(p: Partial<WorkdayRawField> & { automationId: string; widget: string }): WorkdayRawField {
  return { label: p.automationId, required: false, ...p };
}

/** In-memory page: fill() stores values as a real DOM would; readBack() returns them. */
class FakeDriver implements WorkdayPageDriver {
  filled = new Map<string, string>();
  fillCount = 0;
  scanCount = 0;

  constructor(
    private readonly fields: WorkdayRawField[],
    private readonly cfg: { authWall?: boolean; sabotage?: string; unreadable?: Set<string> } = {}
  ) {}

  async isAuthWall(): Promise<boolean> {
    return this.cfg.authWall ?? false;
  }
  async scan(): Promise<WorkdayRawField[]> {
    this.scanCount++;
    return this.fields;
  }
  async fill(intent: FieldIntent): Promise<void> {
    this.fillCount++;
    // Sabotage = the page stored something other than what we asked for.
    const stored = intent.field.id === this.cfg.sabotage ? `${intent.value} (tampered)` : intent.value;
    this.filled.set(intent.field.id, stored);
  }
  async readBack(field: FormField): Promise<string | null> {
    if (this.cfg.unreadable?.has(field.id)) return null;
    return this.filled.get(field.id) ?? null;
  }
}

let dir: string;
let store: EventStore;
let recorder: SubmissionRecorder;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-adapter-'));
  store = new EventStore(path.join(dir, 'events.jsonl'));
  recorder = new SubmissionRecorder(store, path.join(dir, 'receipts'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const PERSONAL: WorkdayRawField[] = [
  raw({ automationId: 'legalNameSection_firstName', label: 'First Name', widget: 'text', required: true }),
  raw({ automationId: 'email', label: 'Email', widget: 'email', required: true }),
  raw({ automationId: 'workAuth', label: 'Authorized to work in the US?', widget: 'dropdown', options: ['Yes', 'No'], required: true }),
];

const KNOWN = stub({
  'First Name': hi('Parv'),
  'Email': hi('p@x.edu'),
  'Authorized to work in the US?': hi('Yes'),
});

function eventTypes(): string[] {
  return store.readAll().events.map((e) => e.type);
}

describe('WorkdayAdapter', () => {
  it('verifies when the independent read-back matches the payload', async () => {
    const driver = new FakeDriver(PERSONAL);
    const outcome = await new WorkdayAdapter(driver, KNOWN, { appId: APP_ID, recorder }).run(CTX);

    expect(outcome.kind).toBe('verified');
    if (outcome.kind === 'verified') expect(outcome.verdict.pass).toBe(true);
    expect(driver.fillCount).toBe(3);
    expect(eventTypes()).toContain('fill_verified');
    expect(eventTypes()).not.toContain('submitted');
  });

  it('mutation test: a sabotaged read-back fails the verdict and never submits', async () => {
    const driver = new FakeDriver(PERSONAL, { sabotage: 'email' });
    const outcome = await new WorkdayAdapter(driver, KNOWN, { appId: APP_ID, recorder }).run(CTX);

    expect(outcome.kind).toBe('verify_failed');
    if (outcome.kind === 'verify_failed') {
      const failed = outcome.verdict.checks.filter((c) => !c.pass);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.fieldId).toBe('email');
    }
    // Honest record: fill_verified with pass=false, never a submission.
    const submitted = store.readAll().events.filter((e) => e.type === 'submitted');
    expect(submitted).toHaveLength(0);
    const fv = store.readAll().events.find((e) => e.type === 'fill_verified');
    expect(fv?.payload.pass).toBe(false);
  });

  it('a null (unreadable) read-back fails the verdict — unverified is never verified', async () => {
    const driver = new FakeDriver(PERSONAL, { unreadable: new Set(['workAuth']) });
    const outcome = await new WorkdayAdapter(driver, KNOWN, { appId: APP_ID, recorder }).run(CTX);
    expect(outcome.kind).toBe('verify_failed');
  });

  it('abstains on a required unknown question BEFORE any fill (no browser mutation)', async () => {
    const fields = [
      ...PERSONAL,
      raw({ automationId: 'q_essay', label: 'Explain your favorite distributed system', widget: 'textarea', required: true }),
    ];
    const driver = new FakeDriver(fields);
    const outcome = await new WorkdayAdapter(driver, KNOWN, { appId: APP_ID, recorder }).run(CTX);

    expect(outcome.kind).toBe('abstained');
    if (outcome.kind === 'abstained') {
      expect(outcome.reasons.some((r) => r.label.includes('distributed system'))).toBe(true);
    }
    expect(driver.fillCount).toBe(0); // nothing was filled on an uncertain form
    expect(eventTypes()).toEqual(['abstained']);
    expect(eventTypes()).not.toContain('submitted');
  });

  it('abstains on a required field with an unknown widget', async () => {
    const fields = [
      ...PERSONAL,
      raw({ automationId: 'sig', label: 'Sign here', widget: 'canvas-signature', required: true }),
    ];
    const outcome = await new WorkdayAdapter(new FakeDriver(fields), KNOWN, { appId: APP_ID, recorder }).run(CTX);
    expect(outcome.kind).toBe('abstained');
    if (outcome.kind === 'abstained') {
      expect(outcome.reasons.some((r) => r.why.includes('unknown field widget'))).toBe(true);
    }
  });

  it('surfaces EEO fields and never fills them', async () => {
    const fields = [
      ...PERSONAL,
      raw({ automationId: 'Self_Identify_gender', label: 'Gender', widget: 'dropdown', options: ['Male', 'Female'], section: 'voluntaryDisclosures' }),
    ];
    const driver = new FakeDriver(fields);
    const outcome = await new WorkdayAdapter(driver, KNOWN, { appId: APP_ID, recorder }).run(CTX);

    expect(outcome.kind).toBe('verified');
    if (outcome.kind === 'verified') {
      expect(outcome.eeo.map((e) => e.id)).toEqual(['Self_Identify_gender']);
    }
    expect(driver.filled.has('Self_Identify_gender')).toBe(false);
  });

  it('abstains (never "verified") when no fillable fields are detected', async () => {
    // A form whose only field is EEO -> zero fillable fields -> verifying
    // nothing must NOT be a vacuous pass.
    const onlyEeo = [
      raw({ automationId: 'Self_Identify_gender', label: 'Gender', widget: 'dropdown', options: ['Male', 'Female'], section: 'voluntaryDisclosures' }),
    ];
    const driver = new FakeDriver(onlyEeo);
    const outcome = await new WorkdayAdapter(driver, KNOWN, { appId: APP_ID, recorder }).run(CTX);

    expect(outcome.kind).toBe('abstained');
    if (outcome.kind === 'abstained') {
      expect(outcome.reasons.some((r) => r.why.includes('no fillable fields'))).toBe(true);
      expect(outcome.eeo.map((e) => e.id)).toEqual(['Self_Identify_gender']);
    }
    expect(driver.fillCount).toBe(0);
    expect(eventTypes()).not.toContain('submitted');
  });

  it('stops at the auth wall without scanning or filling', async () => {
    const driver = new FakeDriver(PERSONAL, { authWall: true });
    const outcome = await new WorkdayAdapter(driver, KNOWN, { appId: APP_ID, recorder }).run(CTX);

    expect(outcome.kind).toBe('auth_required');
    expect(driver.scanCount).toBe(0);
    expect(driver.fillCount).toBe(0);
  });

  it('never-submit invariant: no path writes a submitted event', async () => {
    // verified path
    await new WorkdayAdapter(new FakeDriver(PERSONAL), KNOWN, { appId: APP_ID, recorder }).run(CTX);
    // verify_failed path (separate appId to dodge the duplicate guard, irrelevant here)
    const id2 = appIdFor('Workday Co', 'Other Role');
    await new WorkdayAdapter(new FakeDriver(PERSONAL, { sabotage: 'email' }), KNOWN, { appId: id2, recorder }).run(CTX);
    // abstained path
    const id3 = appIdFor('Workday Co', 'Third Role');
    const withUnknown = [...PERSONAL, raw({ automationId: 'q', label: 'Unknowable?', widget: 'text', required: true })];
    await new WorkdayAdapter(new FakeDriver(withUnknown), KNOWN, { appId: id3, recorder }).run(CTX);

    const submitted = store.readAll().events.filter((e) => e.type === 'submitted');
    expect(submitted).toHaveLength(0);
  });

  it('runs without a recorder (stub-demo mode): no events, still returns the outcome', async () => {
    const outcome = await new WorkdayAdapter(new FakeDriver(PERSONAL), KNOWN).run(CTX);
    expect(outcome.kind).toBe('verified');
    expect(eventTypes()).toHaveLength(0);
  });
});
