/**
 * WorkdayAdapter: the verify-or-abstain orchestrator for Workday. This is the
 * "browser glue" M2 deferred, built behind a driver interface so the wiring
 * (scan -> map -> build intent -> fill -> read back -> verify -> record) is
 * unit-testable without a real browser.
 *
 * Order of trust (AGENTS.md invariants 1 and 2):
 * 1. Build the exact IntentPayload BEFORE any fill mutation. If anything is
 *    unknown, low-confidence, legal/EEO without a human-approved answer, or a
 *    required field has an unknown widget -> ABSTAIN, and no field is ever
 *    filled (we stop before the first browser mutation).
 * 2. After filling, an INDEPENDENT read-back of every field is diffed against
 *    the payload by the Verifier (which never saw the fill). One mismatch =
 *    verify_failed.
 *
 * NEVER SUBMITS. There is no submit method on WorkdayPageDriver, so submission
 * is structurally impossible here, not merely skipped (this session's hard
 * constraint). A green verify yields outcome `verified` = "human must review
 * and click Submit". Re-enabling submission (under AGENTS.md batch-approval +
 * verifier-green + receipt) is a deliberate future increment.
 */

import { WorkdaySchemaMapper } from './WorkdaySchemaMapper.js';
import type { WorkdayRawField, WorkdayEeoField, WorkdayUnmappedField } from './WorkdaySchemaMapper.js';
import { IntentPayloadBuilder } from './IntentPayload.js';
import type { FieldIntent, FormField, AbstainReason, AnswerSource } from './IntentPayload.js';
import type { AnswerContext } from './AnswerGenerator.js';
import { Verifier } from './Verifier.js';
import type { ReadBackValue, VerifierVerdict } from './Verifier.js';
import type { SubmissionRecorder } from './SubmissionRecorder.js';

/**
 * The narrow surface the orchestrator needs from a live page. Deliberately
 * has NO submit method: the never-submit guarantee is enforced by the type,
 * not by remembering not to call it.
 */
export interface WorkdayPageDriver {
  /** True when a Workday sign-in / create-account wall blocks the form. */
  isAuthWall(): Promise<boolean>;
  /** Raw field descriptors for the current wizard step (interpretation happens in the mapper). */
  scan(): Promise<WorkdayRawField[]>;
  /** Set one field's value on the page. */
  fill(intent: FieldIntent): Promise<void>;
  /** Read one field's current value back, or null if unreadable / empty. */
  readBack(field: FormField): Promise<string | null>;
}

export type WorkdayOutcome =
  | { kind: 'auth_required' }
  | {
      kind: 'abstained';
      reasons: AbstainReason[];
      eeo: WorkdayEeoField[];
      unmapped: WorkdayUnmappedField[];
    }
  | {
      kind: 'verify_failed';
      verdict: VerifierVerdict;
      intents: FieldIntent[];
      eeo: WorkdayEeoField[];
    }
  | {
      kind: 'verified';
      verdict: VerifierVerdict;
      intents: FieldIntent[];
      skipped: FormField[];
      eeo: WorkdayEeoField[];
      unmapped: WorkdayUnmappedField[];
    };

export interface WorkdayAdapterOptions {
  /** 12-hex app id (events.appIdFor). Required for event recording to happen. */
  appId?: string;
  /** Records fill_verified / abstained. Omitted in stub demos to avoid touching the log. */
  recorder?: SubmissionRecorder;
  mapper?: WorkdaySchemaMapper;
  verifier?: Verifier;
}

export class WorkdayAdapter {
  constructor(
    private readonly driver: WorkdayPageDriver,
    private readonly answers: AnswerSource,
    private readonly opts: WorkdayAdapterOptions = {}
  ) {}

  async run(ctx: AnswerContext, resumePdfPath?: string): Promise<WorkdayOutcome> {
    if (await this.driver.isAuthWall()) return { kind: 'auth_required' };

    const mapper = this.opts.mapper ?? new WorkdaySchemaMapper();
    const verifier = this.opts.verifier ?? new Verifier();
    const builder = new IntentPayloadBuilder(this.answers);

    const schema = mapper.map(await this.driver.scan());
    const payload = builder.build(schema.fields.map((f) => f.field), ctx, resumePdfPath);

    // A required field whose widget the mapper does not understand cannot be
    // filled safely; it must abstain (Greenhouse mapper's "required unmapped
    // must abstain upstream", enforced here rather than hoped for).
    const unmappedReasons: AbstainReason[] = schema.unmapped
      .filter((u) => u.required)
      .map((u) => ({
        fieldId: u.automationId,
        label: u.label,
        why: `unknown field widget "${u.widget}" — cannot fill safely`,
      }));

    const reasons = [...payload.reasons, ...unmappedReasons];

    // Abstain BEFORE the first fill: no browser mutation happens on any
    // uncertain form. EEO + unmapped fields are surfaced for the human.
    if (reasons.length > 0) {
      this.record((r, appId) => r.recordAbstain(appId, reasons));
      return { kind: 'abstained', reasons, eeo: schema.eeo, unmapped: schema.unmapped };
    }

    for (const intent of payload.intents) await this.driver.fill(intent);

    const readBacks: ReadBackValue[] = [];
    for (const intent of payload.intents) {
      readBacks.push({ fieldId: intent.field.id, actual: await this.driver.readBack(intent.field) });
    }

    const verdict = verifier.verify(payload.intents, readBacks);
    // Recorded for both outcomes: pass=false is the honest record of a fill
    // that failed read-back, not a submission.
    this.record((r, appId) => r.recordFillVerified(appId, verdict));

    if (!verdict.pass) {
      return { kind: 'verify_failed', verdict, intents: payload.intents, eeo: schema.eeo };
    }
    return {
      kind: 'verified',
      verdict,
      intents: payload.intents,
      skipped: payload.skipped,
      eeo: schema.eeo,
      unmapped: schema.unmapped,
    };
  }

  private record(fn: (r: SubmissionRecorder, appId: string) => void): void {
    if (this.opts.recorder && this.opts.appId) fn(this.opts.recorder, this.opts.appId);
  }
}
