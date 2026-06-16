/**
 * Autopilot: the loop that turns "fill + verify" into autonomous application
 * submission with the designed human touchpoints (AGENTS.md mission).
 *
 *   fill+verify (WorkdayAdapter, submit-free)
 *      -> abstained      : flag each unknown to the inbox + fire a desktop
 *                          notification, STOP at needs_input. Once Parv answers
 *                          (AnswerInbox.resolve), the next run resumes and the
 *                          question is no longer unknown.
 *      -> verify_failed  : notify, STOP. A bad fill is NEVER submitted.
 *      -> auth_required  : notify, STOP (human logs in / solves captcha).
 *      -> verified       : record fill_verified. Then:
 *                            - no approval  -> STOP at ready_to_submit (default);
 *                            - approval     -> click submit, read the ATS
 *                              confirmation, write a receipt, notify complete.
 *
 * WHY submission lives HERE and not in the adapter (maker/checker, invariant 2):
 * the fill+verify maker only ever holds a submit-free WorkdayPageDriver, so it
 * physically cannot submit. The Autopilot holds a separate SubmitDriver and may
 * submit only after an INDEPENDENT verified verdict AND an explicit approval.
 *
 * WHY idempotent (invariant 3): a submitted application short-circuits before
 * the form is even re-touched; the event store's duplicate-submitted guard is
 * the backstop. One application per company+role, ever.
 */

import type { AnswerContext } from './AnswerGenerator.js';
import type { WorkdayOutcome } from './WorkdayAdapter.js';
import type { VerifierVerdict } from './Verifier.js';
import { Notifier } from './Notifier.js';
import { AnswerInbox } from './AnswerInbox.js';
import type { PendingQuestion } from './AnswerInbox.js';
import { SubmissionRecorder } from './SubmissionRecorder.js';
import type { Receipt } from './SubmissionRecorder.js';
import { EventStore } from './../store/EventStore.js';

/** The fill+verify step the Autopilot drives. WorkdayAdapter satisfies it. */
export interface FillVerifyStep {
  run(ctx: AnswerContext, resumePdfPath?: string): Promise<WorkdayOutcome>;
}

/**
 * Submission surface, deliberately separate from the submit-free
 * WorkdayPageDriver the adapter uses. WorkdayDriver implements both; each
 * consumer sees only its slice (interface segregation).
 */
export interface SubmitDriver {
  clickSubmit(): Promise<void>;
  /** The ATS confirmation id/message after submit, or null if none was shown. */
  readConfirmation(): Promise<string | null>;
}

/** The human's "click of a button": authorization to submit this application. */
export interface BatchApproval {
  approvedBy: string;
  approvedAt: string;
  note?: string;
}

export interface JobRef {
  /** 12-hex idempotency key (events.appIdFor(company, role)). */
  appId: string;
  company: string;
  role: string;
  resumePdfPath?: string;
  screenshotPaths?: string[];
}

export type AutopilotResult =
  | { phase: 'auth_required' }
  | { phase: 'needs_input'; pending: PendingQuestion[] }
  | { phase: 'verify_failed'; verdict: VerifierVerdict }
  | { phase: 'ready_to_submit'; verdict: VerifierVerdict }
  | { phase: 'submitted'; receipt: Receipt; verdict: VerifierVerdict }
  // Submit was clicked but the ATS returned NO confirmation: we cannot assert
  // the application was received, so it is NOT recorded as submitted.
  | { phase: 'submit_unconfirmed'; verdict: VerifierVerdict }
  | { phase: 'already_submitted' };

export interface AutopilotDeps {
  adapter: FillVerifyStep;
  submit: SubmitDriver;
  notifier: Notifier;
  inbox: AnswerInbox;
  store: EventStore;
  recorder: SubmissionRecorder;
}

export class Autopilot {
  constructor(private readonly deps: AutopilotDeps) {}

  async run(ctx: AnswerContext, job: JobRef, approval?: BatchApproval): Promise<AutopilotResult> {
    const { adapter, submit, notifier, inbox, store, recorder } = this.deps;

    // Idempotency: a submitted application is never re-touched.
    if (store.projection().isSubmitted(job.appId)) {
      return { phase: 'already_submitted' };
    }

    const outcome = await adapter.run(ctx, job.resumePdfPath);

    switch (outcome.kind) {
      case 'auth_required':
        notifier.captcha(job.company);
        return { phase: 'auth_required' };

      case 'abstained': {
        recorder.recordAbstain(job.appId, outcome.reasons);
        const pending: PendingQuestion[] = [];
        for (const r of outcome.reasons) {
          const entry = inbox.flag(r.label, ctx, r.why);
          if (entry) {
            notifier.unknownQuestion(r.label, job.company);
            pending.push(entry);
          }
        }
        return { phase: 'needs_input', pending };
      }

      case 'verify_failed':
        // Honest record (fill_verified, pass:false) — a fill that failed
        // read-back, never a submission.
        recorder.recordFillVerified(job.appId, outcome.verdict);
        notifier.abstained(job.company, outcome.verdict.checks.filter((c) => !c.pass).length);
        return { phase: 'verify_failed', verdict: outcome.verdict };

      case 'verified': {
        recorder.recordFillVerified(job.appId, outcome.verdict);

        // Fill-only default: without an explicit approval we STOP here. The
        // human reviews and approves (the "click of a button").
        if (!approval) {
          return { phase: 'ready_to_submit', verdict: outcome.verdict };
        }

        await submit.clickSubmit();
        const confirmation = await submit.readConfirmation();

        // No ATS confirmation => we CANNOT assert the application was received
        // (the click may have hit a validation wall). Recording 'submitted' here
        // is a false success — the exact failure verify-or-abstain forbids, and
        // the Ashby silent-drop lesson (2026-06-10). So we do NOT record it;
        // the app stays un-applied and the human is told to complete it.
        if (!confirmation) {
          notifier.error(
            `${job.company} — ${job.role}: submit clicked but the ATS gave NO confirmation. NOT recorded as applied — complete/verify it manually.`
          );
          return { phase: 'submit_unconfirmed', verdict: outcome.verdict };
        }

        const receipt = recorder.recordSubmission({
          appId: job.appId,
          company: job.company,
          role: job.role,
          intents: outcome.intents,
          skipped: outcome.skipped.map((f) => f.label),
          ...(job.resumePdfPath ? { resumePdfPath: job.resumePdfPath } : {}),
          screenshotPaths: job.screenshotPaths ?? [],
          atsConfirmation: confirmation,
        });
        notifier.batchComplete(`${job.company} — ${job.role}: submitted (${confirmation})`);
        return { phase: 'submitted', receipt, verdict: outcome.verdict };
      }
    }
  }
}
