/**
 * Orchestrator: the M7 integration seam. It composes the verified subsystems
 * shipped in M3–M6 into ONE end-to-end flow, and adds NO new trust of its own:
 *
 *   tailorAndQueue: Tailor (its own verify-or-abstain) -> if verified, queue a
 *     Ready application through the single event log; if abstained, notify and
 *     do NOT queue (a Ready app always has a verified, shippable resume PDF).
 *   apply:          open a portal session (ApplySessionFactory) -> run the
 *     Autopilot (fill -> INDEPENDENT read-back -> Verifier -> gated submit).
 *     An ATS with no verified filler ABSTAINS (unsupported_ats), never guesses.
 *   advance:        tailorAndQueue, then (if Ready + apply requested) apply.
 *
 * WHY this owns no filling or judging (maker/checker, invariants 1–2): the
 * Tailor verifies its own output; the Autopilot fills with one driver and
 * verifies with an independent one and submits only on a verified verdict + an
 * explicit approval. The Orchestrator only routes a job between those gates.
 *
 * Single writer (invariant 4): every state change goes through ONE locked
 * EventStore (apps.eventStore()). The Orchestrator appends only the `queued`
 * event; the Autopilot/SubmissionRecorder append the apply events. Recording
 * lives in exactly one layer per stage (LESSONS 2026-06-16), joined by
 * appIdFor(company, role).
 */

import type { Job, EvaluationResult, TailoringResult, Application } from '../types.js';
import type { CoverLetterData } from '../tailor/CoverLetterBuilder.js';
import { Autopilot } from '../applier/Autopilot.js';
import type {
  FillVerifyStep,
  SubmitDriver,
  JobRef,
  BatchApproval,
  AutopilotResult,
} from '../applier/Autopilot.js';
import type { AnswerContext } from '../applier/AnswerGenerator.js';
import type { AnswerSource } from '../applier/IntentPayload.js';
import { SubmissionRecorder } from '../applier/SubmissionRecorder.js';
import { Notifier } from '../applier/Notifier.js';
import { AnswerInbox } from '../applier/AnswerInbox.js';
import { ApplicationStore, DuplicateApplicationError } from '../tracker/ApplicationStore.js';
import { appIdFor } from '../store/events.js';
import { Logger } from '../utils/Logger.js';

/** What the Orchestrator needs from the tailoring subsystem. Tailor satisfies it. */
export interface TailorStep {
  tailor(job: Job, evaluation: EvaluationResult, coverData?: CoverLetterData): Promise<TailoringResult>;
}

/** A live, ATS-bound fill+verify+submit surface for one application. */
export interface ApplySession {
  adapter: FillVerifyStep;
  submit: SubmitDriver;
  /** Tear down the browser/page. Always called, even on a thrown apply. */
  close(): Promise<void>;
}

/**
 * Opens a portal session for an application. Returns `unsupported` when no
 * verified filler exists for the application's ATS — the Orchestrator surfaces
 * that as an abstain (verify-or-abstain at the portal seam), never a guess.
 */
export type OpenResult =
  | { ok: true; session: ApplySession }
  | { ok: false; unsupported: true; ats: string };

export interface ApplySessionFactory {
  open(app: Application, answers: AnswerSource): Promise<OpenResult>;
}

export type TailorGateResult =
  | { phase: 'skipped_score' }
  | { phase: 'already_submitted' }
  | { phase: 'tailor_abstained'; reason: string }
  | { phase: 'queued'; application: Application };

export type ApplyGateResult = AutopilotResult | { phase: 'unsupported_ats'; ats: string };

export interface AdvanceResult {
  tailor: TailorGateResult;
  apply?: ApplyGateResult;
}

export interface AdvanceOptions {
  /** Open a browser and run the apply step. Without it, advance stops at queued. */
  apply?: boolean;
  /** The human's "click of a button". Without it, apply stops at ready_to_submit. */
  approval?: BatchApproval;
  coverData?: CoverLetterData;
}

export interface OrchestratorDeps {
  /** Required for tailorAndQueue/advance; an apply-only run can omit it. */
  tailor?: TailorStep;
  apps: ApplicationStore;
  notifier: Notifier;
  inbox: AnswerInbox;
  /** Rebuilt per pass so a freshly-learned answer is seen (LESSONS 2026-06-16). */
  answers: () => AnswerSource;
  /** Present only when applying. Owns ATS support + browser lifecycle. */
  sessions?: ApplySessionFactory;
  receiptsDir?: string;
}

export class Orchestrator {
  private log = new Logger('orchestrator');

  constructor(private readonly deps: OrchestratorDeps) {}

  /** Tailor under verify-or-abstain; queue a Ready application only if verified. */
  async tailorAndQueue(
    job: Job,
    evaluation: EvaluationResult,
    coverData?: CoverLetterData
  ): Promise<TailorGateResult> {
    const { tailor, apps, notifier } = this.deps;
    if (!tailor) throw new Error('Orchestrator.tailorAndQueue requires a TailorStep dep');
    const appId = appIdFor(job.company, job.title);

    if (apps.eventStore().projection().isSubmitted(appId)) {
      return { phase: 'already_submitted' };
    }
    if (!evaluation.shouldApply) {
      return { phase: 'skipped_score' };
    }

    const t = await tailor.tailor(job, evaluation, coverData);

    // The Tailor is the maker AND its own checker here; a non-verified result
    // (dropped section, wrong contact, missing keyword, broken PDF render) must
    // never be queued as a shippable application.
    if (!t.verified || !t.pdfPath) {
      const reason = t.abstainReason ?? 'resume did not verify';
      notifier.notify({
        kind: 'abstain',
        title: 'Career-Ops: resume abstained',
        message: `${job.company} — ${job.title}: ${truncate(reason, 90)}`,
        urgent: true,
      });
      this.log.warn(`Tailor ABSTAINED ${job.company} — ${job.title}: ${reason}`);
      return { phase: 'tailor_abstained', reason };
    }

    const application: Application = {
      id: apps.nextId(),
      jobId: job.id,
      date: new Date().toISOString().split('T')[0]!,
      company: job.company,
      role: job.title,
      score: evaluation.score,
      url: job.applyUrl ?? job.url,
      status: 'Ready',
      resumeVariant: t.resumeVariant,
      pdfPath: t.pdfPath,
      ...(t.coverLetterPath ? { coverLetterPath: t.coverLetterPath } : {}),
      notes: `${job.platform} | ${job.location || 'Remote'}`,
      jd: job.jd,
      tailoredAt: t.tailoredAt,
    };

    try {
      apps.add(application);
      this.log.info(`Queued ${job.company} — ${job.title}`, { id: application.id, variant: t.resumeVariant });
      return { phase: 'queued', application };
    } catch (err) {
      if (!(err instanceof DuplicateApplicationError)) throw err;
      // Already queued (re-run): refresh its artifacts to the latest tailoring,
      // do not double-add. Idempotency holds at the queue, not just the submit.
      const existing = apps.findByCompanyAndRole(job.company, job.title);
      if (!existing) throw err;
      apps.update(existing.id, {
        pdfPath: t.pdfPath,
        ...(t.coverLetterPath ? { coverLetterPath: t.coverLetterPath } : {}),
      });
      return {
        phase: 'queued',
        // Mirror the conditional update: a re-tailor with no new cover letter
        // must not drop the path already on the stored application.
        application: {
          ...existing,
          pdfPath: t.pdfPath,
          ...(t.coverLetterPath ? { coverLetterPath: t.coverLetterPath } : {}),
        },
      };
    }
  }

  /** Open a portal session and run the gated fill/verify/submit Autopilot. */
  async apply(app: Application, opts: { approval?: BatchApproval } = {}): Promise<ApplyGateResult> {
    const { apps, notifier, inbox, sessions } = this.deps;
    const appId = appIdFor(app.company, app.role);

    // Idempotency: never open a browser for an already-submitted application.
    if (apps.eventStore().projection().isSubmitted(appId)) {
      return { phase: 'already_submitted' };
    }
    if (!sessions) {
      throw new Error('Orchestrator.apply called without an ApplySessionFactory');
    }

    const opened = await sessions.open(app, this.deps.answers());
    if (!opened.ok) {
      // No verified filler for this ATS: abstain, never guess (invariant 1).
      notifier.notify({
        kind: 'abstain',
        title: 'Career-Ops: unsupported portal',
        message: `${app.company}: no verified filler for ATS "${opened.ats}" — skipped (no guess).`,
        urgent: true,
      });
      this.log.warn(`Unsupported ATS "${opened.ats}" for ${app.company} — ${app.role}: abstained`);
      return { phase: 'unsupported_ats', ats: opened.ats };
    }

    const recorder = new SubmissionRecorder(apps.eventStore(), this.deps.receiptsDir);
    const pilot = new Autopilot({
      adapter: opened.session.adapter,
      submit: opened.session.submit,
      notifier,
      inbox,
      store: apps.eventStore(),
      recorder,
    });

    const job: JobRef = {
      appId,
      company: app.company,
      role: app.role,
      ...(app.pdfPath ? { resumePdfPath: app.pdfPath } : {}),
    };
    const ctx: AnswerContext = {
      company: app.company,
      role: app.role,
      resumeVariant: app.resumeVariant,
      ...(app.jd ? { jd: app.jd } : {}),
    };

    try {
      return await pilot.run(ctx, job, opts.approval);
    } finally {
      await opened.session.close().catch(() => {});
      // Re-render the generated view (applications.json/.md) from the now-updated
      // shared log: the Autopilot's submit event goes straight to the EventStore,
      // bypassing the ApplicationStore facade that owns the view. Best-effort: the
      // submission is already durable on the log + receipt, so a view-rewrite IO
      // error must NOT mask the apply result (or any thrown error) to the caller.
      try {
        apps.load();
      } catch (err) {
        this.log.warn(`view refresh after apply failed (log is authoritative): ${(err as Error).message}`);
      }
    }
  }

  /** Full pass: tailor+queue, then (if Ready and apply requested) apply. */
  async advance(job: Job, evaluation: EvaluationResult, opts: AdvanceOptions = {}): Promise<AdvanceResult> {
    const tailor = await this.tailorAndQueue(job, evaluation, opts.coverData);
    if (tailor.phase !== 'queued') return { tailor };
    if (!opts.apply || !this.deps.sessions) return { tailor };
    const apply = await this.apply(tailor.application, { approval: opts.approval });
    return { tailor, apply };
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
