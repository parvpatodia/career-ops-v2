/**
 * Career-Ops MCP tool handlers. Temp store + AnswerInbox, fakes for the
 * browser/email/tailor capabilities so the handler logic is verified with no
 * network, no browser, no PII.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CareerOpsTools } from '../../src/mcp/tools.js';
import type { ToolContext, TailorCap } from '../../src/mcp/tools.js';
import { ApplicationStore } from '../../src/tracker/ApplicationStore.js';
import { AnswerInbox } from '../../src/applier/AnswerInbox.js';
import type { Application } from '../../src/types.js';
import type { ResumeTailorResult } from '../../src/tailor/Tailor.js';

let dir: string;
let store: ApplicationStore;
let inbox: AnswerInbox;

function app(over: Partial<Application> = {}): Application {
  return {
    id: '001', jobId: 'j1', date: '2026-06-16', company: 'Globex', role: 'ML Intern', score: 80,
    url: 'https://boards.greenhouse.io/globex/jobs/1', status: 'Ready', resumeVariant: 'ml',
    notes: 'greenhouse | Remote', jd: 'Build ML in Python.', ...over,
  };
}
function tools(extra: Partial<ToolContext> = {}): CareerOpsTools {
  return new CareerOpsTools({ store, inbox, ...extra });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  store = new ApplicationStore(path.join(dir, 'applications.json'), path.join(dir, 'applications.md'));
  inbox = new AnswerInbox(path.join(dir, 'pending.json'), path.join(dir, 'learned.yml'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('CareerOpsTools', () => {
  it('list_applications + stats reflect the store', () => {
    store.add(app({ id: '001', company: 'Globex' }));
    store.add(app({ id: '002', company: 'Acme', role: 'AI Intern' }));
    store.update('002', { status: 'Applied' });
    const t = tools();
    expect((t.listApplications({}) as any).count).toBe(2);
    expect((t.listApplications({ status: 'Applied' }) as any).count).toBe(1);
    expect((t.applicationStats() as any).byStatus).toMatchObject({ Ready: 1, Applied: 1 });
  });

  it('pending_answers + resolve_answer drive the self-improving loop', () => {
    inbox.flag('Why this team?', { company: 'Globex', role: 'ML Intern' }, 'unknown');
    const t = tools();
    expect((t.pendingAnswers() as any).count).toBe(1);
    expect((t.resolveAnswer({ question: 'Why this team?', answer: 'Your robotics work.' }) as any).ok).toBe(true);
    // learned -> the inbox source now answers it (no longer pending on re-flag attempt)
    expect(inbox.learnedSource().generate('Why this team?', { company: 'Globex', role: 'ML Intern' })?.value)
      .toBe('Your robotics work.');
  });

  it('reconcile_inbox: clear reason when no accounts; updates status when wired', async () => {
    store.add(app({ id: '001', company: 'Scale AI', role: 'AI Builder Intern' }));
    expect((await tools().reconcileInbox({}) as any).ok).toBe(false); // no accounts

    const t = tools({
      accounts: [{ account: 'gmail', host: 'h', user: 'u', password: 'p' }],
      emailFetch: async () => [{ from: 'jobs@scaleai.com', subject: 'Thank you for applying to Scale AI', date: '2026-06-16T10:00:00Z', account: 'gmail' }],
    });
    const r = await t.reconcileInbox({}) as any;
    expect(r.ok).toBe(true);
    expect(r.updates).toHaveLength(1);
    expect(store.getById('001')?.status).toBe('Applied'); // confirmed from the email
  });

  it('tailor_resume surfaces verify-or-abstain + no-fabrication (injected vs skipped)', () => {
    store.add(app({ id: '001' }));
    const fakeTailor: TailorCap = {
      tailorResume: () => ({
        variant: 'ml', tailoredResumePath: '/tmp/r.md', html: '<h2>Skills</h2>',
        injections: [{ keyword: 'Kubernetes', location: 'Skills', reason: 'JD' }],
        skipped: [{ keyword: 'COBOL', reason: 'not attested' }],
        sections: ['Skills'], verdict: { pass: true, checks: [] }, verified: true,
      } as ResumeTailorResult),
    };
    const r = tools({ tailor: fakeTailor }).tailorResume({ applicationId: '001' }) as any;
    expect(r.verified).toBe(true);
    expect(r.injectedKeywords).toEqual(['Kubernetes']);
    expect(r.skippedKeywords).toEqual(['COBOL']); // surfaced, never fabricated
  });

  it('fill_and_verify never claims a submission; reports the gated phase', async () => {
    store.add(app({ id: '001' }));
    expect((await tools().fillAndVerify({ applicationId: '001' }) as any).ok).toBe(false); // not configured

    const t = tools({ apply: async () => ({ phase: 'ready_to_submit', verdict: { pass: true, checks: [] } }) });
    const r = await t.fillAndVerify({ applicationId: '001' }) as any;
    expect(r.phase).toBe('ready_to_submit');
    expect(r.note).toMatch(/review and submit yourself/i);
  });
});
