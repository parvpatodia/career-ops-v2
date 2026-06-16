/**
 * Career-Ops MCP tool handlers. Pure-ish: each takes parsed args + injected
 * capabilities and returns a plain result object (server.ts wraps it as MCP
 * content). This exposes the VERIFIED core as agent-callable tools (adopting the
 * competitor's distribution model) while keeping our differentiators they lack:
 * verify-or-abstain on every fill, no-fabrication tailoring, and inbox
 * confirmation tracking.
 *
 * Capabilities are optional so the server can wire only what's available
 * (e.g. apply needs a browser + profile; reconcile needs email creds); a tool
 * with no capability returns a clear reason instead of throwing.
 */

import type { ApplicationStore } from '../tracker/ApplicationStore.js';
import type { AnswerInbox } from '../applier/AnswerInbox.js';
import { EmailTracker } from '../inbox/EmailTracker.js';
import type { FetchHeaders } from '../inbox/EmailTracker.js';
import type { ImapAccount } from '../inbox/ImapClient.js';
import { jobFromApp } from '../orchestrator/queuePlanning.js';
import type { ApplyGateResult } from '../orchestrator/Orchestrator.js';
import type { ResumeTailorResult } from '../tailor/Tailor.js';
import type { Application, ApplicationStatus, ResumeVariant } from '../types.js';

/** What a tailor capability must provide (the pure verify-or-abstain pipeline). */
export interface TailorCap {
  tailorResume(job: ReturnType<typeof jobFromApp>['job'], variant: ResumeVariant): ResumeTailorResult;
}

export interface ToolContext {
  store: ApplicationStore;
  inbox: AnswerInbox;
  /** Apply one queued application: fill + INDEPENDENT verify, stop (no submit). */
  apply?: (app: Application) => Promise<ApplyGateResult>;
  tailor?: TailorCap;
  emailFetch?: FetchHeaders;
  accounts?: ImapAccount[];
}

export class CareerOpsTools {
  constructor(private readonly ctx: ToolContext) {}

  listApplications(args: { status?: string }): unknown {
    const apps = args.status
      ? this.ctx.store.getByStatus(args.status as ApplicationStatus)
      : this.ctx.store.getAll();
    return {
      count: apps.length,
      applications: apps.map((a) => ({
        id: a.id, company: a.company, role: a.role, status: a.status,
        score: a.score, url: a.url, hasResume: !!a.pdfPath,
      })),
    };
  }

  applicationStats(): unknown {
    const apps = this.ctx.store.getAll();
    const byStatus: Record<string, number> = {};
    for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    return { total: apps.length, byStatus };
  }

  pendingAnswers(): unknown {
    const pending = this.ctx.inbox.listPending();
    return {
      count: pending.length,
      questions: pending.map((p) => ({ label: p.label, company: p.company, why: p.why })),
    };
  }

  resolveAnswer(args: { question: string; answer: string }): unknown {
    this.ctx.inbox.resolve(args.question, args.answer);
    return { ok: true, learned: args.question };
  }

  async reconcileInbox(args: { days?: number }): Promise<unknown> {
    if (!this.ctx.emailFetch || !this.ctx.accounts || this.ctx.accounts.length === 0) {
      return { ok: false, reason: 'No email accounts configured. Add Gmail/Outlook app passwords to .env (GMAIL_USER/GMAIL_APP_PASSWORD, OUTLOOK_*).' };
    }
    const tracker = new EmailTracker(this.ctx.store, this.ctx.emailFetch);
    const summary = await tracker.run(this.ctx.accounts, args.days ?? 30);
    return { ok: true, ...summary };
  }

  /** Verify-or-abstain tailoring (no PDF render): proves no-fabrication injection. */
  tailorResume(args: { applicationId: string }): unknown {
    if (!this.ctx.tailor) return { ok: false, reason: 'Tailoring not configured (needs config/profile.yml + cv/).' };
    const app = this.ctx.store.getById(args.applicationId);
    if (!app) return { ok: false, reason: `Application ${args.applicationId} not found.` };
    const { job } = jobFromApp(app);
    const r = this.ctx.tailor.tailorResume(job, app.resumeVariant);
    return {
      ok: true,
      applicationId: args.applicationId,
      variant: r.variant,
      verified: r.verified,
      injectedKeywords: r.injections.map((i) => i.keyword),
      skippedKeywords: r.skipped.map((s) => s.keyword), // surfaced, never fabricated
      abstainReason: r.verified ? undefined : r.verdict.checks.filter((c) => !c.pass).map((c) => c.name).join(', '),
    };
  }

  /** Fill + INDEPENDENTLY verify a queued application; STOP before submit. */
  async fillAndVerify(args: { applicationId: string }): Promise<unknown> {
    if (!this.ctx.apply) return { ok: false, reason: 'Apply not configured (needs a browser + config/profile.yml).' };
    const app = this.ctx.store.getById(args.applicationId);
    if (!app) return { ok: false, reason: `Application ${args.applicationId} not found.` };
    const result = await this.ctx.apply(app);
    // Surface the verify-or-abstain outcome honestly; never claim a submission.
    return {
      ok: true,
      applicationId: args.applicationId,
      phase: result.phase,
      note:
        result.phase === 'ready_to_submit' ? 'Every field verified green. Review and submit yourself.'
        : result.phase === 'needs_input' ? 'Unknown question(s) flagged; answer them with resolve_answer, then re-run.'
        : result.phase === 'verify_failed' ? 'Read-back mismatch; NOT submitted.'
        : result.phase === 'unsupported_ats' ? 'No verified filler for this ATS; abstained.'
        : result.phase,
    };
  }
}
