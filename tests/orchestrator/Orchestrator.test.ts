/**
 * SPEC M7: the Orchestrator integration seam. Tested with a fake Tailor and a
 * fake portal session (fake fill+verify + fake submit), a real (temp)
 * ApplicationStore + AnswerInbox, and a dry-run Notifier.
 *
 * Properties under test:
 * - tailor verified  -> a Ready application is queued with its pdfPath;
 * - tailor abstained -> NOTHING is queued, tailor_abstained + an abstain notice;
 * - shouldApply=false -> skipped_score, the Tailor is never invoked;
 * - advance(apply+approval) over a verified fill -> submitted, the queue add and
 *   the submit land in ONE event log joined by the SAME appId, status -> Applied;
 * - verify_failed -> no submit, the app stays Ready;
 * - an unsupported ATS -> unsupported_ats + abstain, never a guessed fill;
 * - idempotency: once submitted, a re-run short-circuits before re-tailoring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Orchestrator } from '../../src/orchestrator/Orchestrator.js';
import type {
  TailorStep,
  ApplySessionFactory,
  OpenResult,
} from '../../src/orchestrator/Orchestrator.js';
import type { FillVerifyStep, SubmitDriver, BatchApproval } from '../../src/applier/Autopilot.js';
import type { ApplicationOutcome } from '../../src/applier/ApplicationAdapter.js';
import type { FieldIntent } from '../../src/applier/IntentPayload.js';
import type { AnswerSource } from '../../src/applier/IntentPayload.js';
import { Notifier } from '../../src/applier/Notifier.js';
import type { Notification } from '../../src/applier/Notifier.js';
import { AnswerInbox } from '../../src/applier/AnswerInbox.js';
import { ApplicationStore } from '../../src/tracker/ApplicationStore.js';
import { appIdFor } from '../../src/store/events.js';
import type { Job, EvaluationResult, TailoringResult } from '../../src/types.js';

const JOB: Job = {
  id: 'gh-001',
  title: 'ML Engineer Intern',
  company: 'Globex',
  url: 'https://boards.greenhouse.io/globex/jobs/1',
  applyUrl: 'https://boards.greenhouse.io/globex/jobs/1',
  platform: 'greenhouse',
  location: 'San Jose, CA',
  remote: false,
  postedAt: '2026-06-12',
  discoveredAt: '2026-06-15',
  jd: 'Build ML systems in Python. Ship with Docker and Kubernetes.',
  status: 'evaluated',
};

const EVAL: EvaluationResult = {
  jobId: JOB.id,
  score: 84,
  breakdown: { skillMatch: 85, experienceMatch: 80, locationMatch: 100, visaMatch: 100, companySignal: 75, timingMatch: 90 },
  reasoning: 'strong fit',
  resumeVariant: 'ml',
  topMatchingSkills: ['Python'],
  missingSkills: [],
  shouldApply: true,
  shouldGenerateCoverLetter: true,
  evaluatedAt: '2026-06-15',
};

const APPROVAL: BatchApproval = { approvedBy: 'parv', approvedAt: '2026-06-16T00:00:00Z' };

// pdfPath points at a real (temp) file so the SubmissionRecorder can sha256 it,
// exactly as it would in production where the Tailor wrote the PDF.
let resumePdf: string;

function verifiedTailoring(overrides: Partial<TailoringResult> = {}): TailoringResult {
  return {
    jobId: JOB.id,
    resumeVariant: 'ml',
    injectedKeywords: [{ keyword: 'Kubernetes', location: 'Skills', reason: 'JD requirement' }],
    tailoredResumePath: path.join(path.dirname(resumePdf), 'resume.md'),
    pdfPath: resumePdf,
    verified: true,
    tailoredAt: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

function abstainedTailoring(): TailoringResult {
  return {
    jobId: JOB.id,
    resumeVariant: 'ml',
    injectedKeywords: [],
    tailoredResumePath: '/tmp/resume.md',
    verified: false,
    abstainReason: 'page-budget: resume exceeds 2 pages',
    tailoredAt: '2026-06-16T00:00:00Z',
  };
}

class FakeTailor implements TailorStep {
  calls = 0;
  constructor(private readonly result: TailoringResult) {}
  async tailor(): Promise<TailoringResult> {
    this.calls++;
    return this.result;
  }
}

function intent(id: string, label: string, value: string): FieldIntent {
  return { field: { id, label, type: 'text', required: true }, value, source: 'answer-source', confidence: 'high' };
}

const VERIFIED: ApplicationOutcome = {
  kind: 'verified',
  verdict: { pass: true, checks: [{ fieldId: 'f1', label: 'First Name', expected: 'Ada', actual: 'Ada', pass: true }] },
  intents: [intent('f1', 'First Name', 'Ada')],
  skipped: [],
  eeo: [],
  unmapped: [],
};

const VERIFY_FAILED: ApplicationOutcome = {
  kind: 'verify_failed',
  verdict: { pass: false, checks: [{ fieldId: 'f1', label: 'First Name', expected: 'Ada', actual: 'Adaa', pass: false }] },
  intents: [intent('f1', 'First Name', 'Ada')],
  eeo: [],
};

class FakeFill implements FillVerifyStep {
  constructor(private readonly outcome: ApplicationOutcome) {}
  async run(): Promise<ApplicationOutcome> {
    return this.outcome;
  }
}

class FakeSubmit implements SubmitDriver {
  clickCount = 0;
  async clickSubmit(): Promise<void> {
    this.clickCount++;
  }
  async readConfirmation(): Promise<string | null> {
    return 'GH-CONF-1';
  }
}

class FakeSessionFactory implements ApplySessionFactory {
  closeCount = 0;
  submit = new FakeSubmit();
  constructor(private readonly outcome: ApplicationOutcome | { unsupported: string }) {}
  async open(): Promise<OpenResult> {
    if ('unsupported' in this.outcome) {
      return { ok: false, unsupported: true, ats: this.outcome.unsupported };
    }
    return {
      ok: true,
      session: {
        adapter: new FakeFill(this.outcome),
        submit: this.submit,
        close: async () => {
          this.closeCount++;
        },
      },
    };
  }
}

const noAnswers: AnswerSource = { generate: () => null };

let dir: string;
let apps: ApplicationStore;
let inbox: AnswerInbox;
let sent: Notification[];
let notifier: Notifier;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-'));
  resumePdf = path.join(dir, 'resume.pdf');
  fs.writeFileSync(resumePdf, '%PDF-1.4 demo bytes');
  apps = new ApplicationStore(path.join(dir, 'applications.json'), path.join(dir, 'applications.md'));
  inbox = new AnswerInbox(path.join(dir, 'pending.json'), path.join(dir, 'learned.yml'));
  sent = [];
  notifier = new Notifier((n) => sent.push(n));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function make(tailoring: TailoringResult, sessions?: FakeSessionFactory) {
  return new Orchestrator({
    tailor: new FakeTailor(tailoring),
    apps,
    notifier,
    inbox,
    answers: () => noAnswers,
    sessions,
    receiptsDir: path.join(dir, 'receipts'),
  });
}

function eventTypes(): string[] {
  return apps.eventStore().readAll().events.map((e) => e.type);
}

describe('Orchestrator', () => {
  it('tailor verified: queues a Ready application carrying its PDF', async () => {
    const orch = make(verifiedTailoring());
    const r = await orch.tailorAndQueue(JOB, EVAL);

    expect(r.phase).toBe('queued');
    const queued = apps.findByCompanyAndRole('Globex', 'ML Engineer Intern');
    expect(queued?.status).toBe('Ready');
    expect(queued?.pdfPath).toBe(resumePdf);
    expect(queued?.resumeVariant).toBe('ml');
    expect(eventTypes()).toEqual(['queued']);
  });

  it('tailor abstained: queues NOTHING, returns tailor_abstained, notifies', async () => {
    const orch = make(abstainedTailoring());
    const r = await orch.tailorAndQueue(JOB, EVAL);

    expect(r.phase).toBe('tailor_abstained');
    if (r.phase === 'tailor_abstained') expect(r.reason).toMatch(/page-budget/);
    expect(apps.getAll()).toHaveLength(0); // a Ready app would have a bad PDF — never queued
    expect(sent.some((n) => n.kind === 'abstain')).toBe(true);
  });

  it('shouldApply=false: skipped_score, the Tailor is never invoked', async () => {
    const tailor = new FakeTailor(verifiedTailoring());
    const orch = new Orchestrator({ tailor, apps, notifier, inbox, answers: () => noAnswers });
    const r = await orch.tailorAndQueue(JOB, { ...EVAL, shouldApply: false });

    expect(r.phase).toBe('skipped_score');
    expect(tailor.calls).toBe(0);
    expect(apps.getAll()).toHaveLength(0);
  });

  it('advance(apply+approval) over a verified fill: submits, one log joined by appId, status -> Applied', async () => {
    const sessions = new FakeSessionFactory(VERIFIED);
    const orch = make(verifiedTailoring(), sessions);

    const r = await orch.advance(JOB, EVAL, { apply: true, approval: APPROVAL });

    expect(r.tailor.phase).toBe('queued');
    expect(r.apply?.phase).toBe('submitted');
    expect(sessions.submit.clickCount).toBe(1);
    expect(sessions.closeCount).toBe(1);

    // The queue add and the apply events live in ONE log, all joined by appId.
    const events = apps.eventStore().readAll().events;
    expect(events.map((e) => e.type)).toEqual(['queued', 'fill_verified', 'submitted', 'confirmed']);
    const appId = appIdFor('Globex', 'ML Engineer Intern');
    expect(events.every((e) => e.appId === appId)).toBe(true);

    // The generated view reflects the submit (Ready -> Applied).
    expect(apps.findByCompanyAndRole('Globex', 'ML Engineer Intern')?.status).toBe('Applied');
  });

  it('advance(apply+approval) over a verify_failed fill: no submit, app stays Ready', async () => {
    const sessions = new FakeSessionFactory(VERIFY_FAILED);
    const orch = make(verifiedTailoring(), sessions);

    const r = await orch.advance(JOB, EVAL, { apply: true, approval: APPROVAL });

    expect(r.apply?.phase).toBe('verify_failed');
    expect(sessions.submit.clickCount).toBe(0);
    expect(eventTypes()).not.toContain('submitted');
    expect(apps.findByCompanyAndRole('Globex', 'ML Engineer Intern')?.status).toBe('Ready');
  });

  it('unsupported ATS: abstains (unsupported_ats), never guesses a fill', async () => {
    const sessions = new FakeSessionFactory({ unsupported: 'workday' });
    const orch = make(verifiedTailoring(), sessions);

    const r = await orch.advance(JOB, EVAL, { apply: true, approval: APPROVAL });

    expect(r.tailor.phase).toBe('queued');
    expect(r.apply?.phase).toBe('unsupported_ats');
    if (r.apply?.phase === 'unsupported_ats') expect(r.apply.ats).toBe('workday');
    expect(eventTypes()).not.toContain('submitted');
    expect(sent.some((n) => n.kind === 'abstain')).toBe(true);
  });

  it('idempotency: once submitted, a re-run short-circuits before re-tailoring', async () => {
    const sessions = new FakeSessionFactory(VERIFIED);
    const tailor = new FakeTailor(verifiedTailoring());
    const orch = new Orchestrator({
      tailor, apps, notifier, inbox, answers: () => noAnswers, sessions, receiptsDir: path.join(dir, 'receipts'),
    });

    const first = await orch.advance(JOB, EVAL, { apply: true, approval: APPROVAL });
    expect(first.apply?.phase).toBe('submitted');
    expect(tailor.calls).toBe(1);

    // Re-run the same job: tailorAndQueue must short-circuit, not re-tailor.
    const second = await orch.tailorAndQueue(JOB, EVAL);
    expect(second.phase).toBe('already_submitted');
    expect(tailor.calls).toBe(1); // never tailored again
  });
});
