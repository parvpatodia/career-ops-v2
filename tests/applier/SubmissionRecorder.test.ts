/**
 * SPEC M2 step 5: receipts. Every submission writes a receipt through the
 * atomic group path: submitted (+ confirmed when the ATS answered) share
 * one correlation id, and the double-submit guard sits underneath.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { EventStore, TransitionError } from '../../src/store/EventStore.js';
import { appIdFor } from '../../src/store/events.js';
import { SubmissionRecorder } from '../../src/applier/SubmissionRecorder.js';
import type { FieldIntent } from '../../src/applier/IntentPayload.js';

let dir: string;
let store: EventStore;
let recorder: SubmissionRecorder;
let pdfPath: string;

const APP_ID = appIdFor('TestCo', 'MLE Intern');

function intent(id: string, label: string, value: string): FieldIntent {
  return {
    field: { id, label, type: 'text', required: true },
    value,
    source: 'answer-source',
    confidence: 'high',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-'));
  store = new EventStore(path.join(dir, 'events.jsonl'));
  recorder = new SubmissionRecorder(store, path.join(dir, 'receipts'));
  pdfPath = path.join(dir, 'resume.pdf');
  fs.writeFileSync(pdfPath, 'pdf-bytes-1234');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function record(confirmation?: string) {
  return recorder.recordSubmission({
    appId: APP_ID,
    company: 'TestCo',
    role: 'MLE Intern',
    intents: [intent('f1', 'First Name', 'Parv'), intent('f2', 'Email', 'p@x.edu')],
    skipped: ['Veteran status'],
    resumePdfPath: pdfPath,
    screenshotPaths: ['/tmp/before.png', '/tmp/after.png'],
    ...(confirmation ? { atsConfirmation: confirmation } : {}),
  });
}

describe('SubmissionRecorder', () => {
  it('writes submitted + confirmed as one correlated group when the ATS confirmed', () => {
    const receipt = record('gh-conf-42');

    const { events } = store.readAll();
    expect(events.map((e) => e.type)).toEqual(['submitted', 'confirmed']);
    expect(new Set(events.map((e) => e.cid)).size).toBe(1);
    expect(events[0]!.cid).toBe(receipt.correlationId);
    expect(store.projection().isConfirmed(APP_ID)).toBe(true);
  });

  it('writes only submitted when no confirmation was observed', () => {
    record();
    const { events } = store.readAll();
    expect(events.map((e) => e.type)).toEqual(['submitted']);
  });

  it('recordConfirmation appends confirmed later, referencing the same correlation id', () => {
    const receipt = record();
    recorder.recordConfirmation(APP_ID, receipt.correlationId, 'gh-conf-99');

    const { events } = store.readAll();
    expect(events.map((e) => e.type)).toEqual(['submitted', 'confirmed']);
    expect(events[1]!.cid).toBe(receipt.correlationId);
    expect(events[1]!.payload.atsConfirmation).toBe('gh-conf-99');
  });

  it('receipt carries fields, skipped, screenshots, and the resume sha256', () => {
    const receipt = record('gh-conf-42');

    expect(receipt.fields).toEqual([
      { label: 'First Name', value: 'Parv' },
      { label: 'Email', value: 'p@x.edu' },
    ]);
    expect(receipt.skipped).toEqual(['Veteran status']);
    expect(receipt.screenshotPaths).toHaveLength(2);
    const expectedSha = createHash('sha256').update('pdf-bytes-1234').digest('hex');
    expect(receipt.resumeSha256).toBe(expectedSha);
  });

  it('archives the receipt as a JSON file named by correlation id', () => {
    const receipt = record('gh-conf-42');
    const file = path.join(dir, 'receipts', `${receipt.correlationId}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.appId).toBe(APP_ID);
    expect(parsed.atsConfirmation).toBe('gh-conf-42');
  });

  it('a second submission for the same appId throws TransitionError and archives nothing new', () => {
    record('gh-conf-42');
    expect(() => record('gh-conf-43')).toThrow(TransitionError);
    expect(fs.readdirSync(path.join(dir, 'receipts'))).toHaveLength(1);
  });

  it('recordFillVerified and recordAbstain land as plain events', () => {
    recorder.recordFillVerified(APP_ID, { pass: true, checks: [] });
    recorder.recordAbstain(APP_ID, [{ fieldId: 'f9', label: 'Odd question', why: 'no known answer' }]);

    const { events } = store.readAll();
    expect(events.map((e) => e.type)).toEqual(['fill_verified', 'abstained']);
    expect((events[1]!.payload.reasons as unknown[]).length).toBe(1);
  });
});
