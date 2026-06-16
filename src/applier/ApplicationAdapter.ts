/**
 * ApplicationAdapter: the ATS-agnostic verify-or-abstain orchestrator. The
 * fill+verify logic is identical across portals (Workday, Greenhouse, Lever,
 * ...); only schema discovery and the DOM selectors differ. Those differences
 * live behind AtsFormSource, so this core is written once and shared.
 *
 * Order of trust (AGENTS.md invariants 1 and 2):
 * 1. Build the exact IntentPayload BEFORE any fill mutation. Unknown,
 *    low-confidence, legal/EEO-without-human-approval, or required-but-unknown
 *    widgets -> ABSTAIN, with no field ever filled.
 * 2. After filling, an INDEPENDENT read-back of every field is diffed against
 *    the payload by the Verifier (which never saw the fill). One mismatch =
 *    verify_failed.
 *
 * NEVER SUBMITS. AtsFormSource has no submit method, so the filler is
 * structurally unable to submit. Submission is the Autopilot's job, gated on a
 * verified verdict + an explicit approval.
 */

import { IntentPayloadBuilder } from './IntentPayload.js';
import type { FieldIntent, FormField, AbstainReason, AnswerSource } from './IntentPayload.js';
import type { AnswerContext } from './AnswerGenerator.js';
import { Verifier } from './Verifier.js';
import type { ReadBackValue, VerifierVerdict } from './Verifier.js';
import type { SubmissionRecorder } from './SubmissionRecorder.js';

/** Self-identification fields, surfaced for the human, never auto-filled. */
export interface EeoField {
  id: string;
  label: string;
}

/** A field whose widget the ATS mapper does not understand. */
export interface UnmappedField {
  id: string;
  label: string;
  required: boolean;
  widget: string;
}

/** The normalized form schema the generic adapter consumes, ATS-independent. */
export interface NormalizedSchema {
  fields: FormField[];
  eeo: EeoField[];
  unmapped: UnmappedField[];
}

/**
 * What an ATS provides to the verify-or-abstain adapter. Deliberately has NO
 * submit method (maker/checker, invariant 2). scanSchema() is where portals
 * differ (Workday: DOM scan + mapper; Greenhouse: board API + mapper);
 * fill/readBack target that portal's DOM.
 */
export interface AtsFormSource {
  readonly ats: string;
  isAuthWall(): Promise<boolean>;
  scanSchema(): Promise<NormalizedSchema>;
  fill(intent: FieldIntent): Promise<void>;
  readBack(field: FormField): Promise<string | null>;
}

export type ApplicationOutcome =
  | { kind: 'auth_required' }
  | { kind: 'abstained'; reasons: AbstainReason[]; eeo: EeoField[]; unmapped: UnmappedField[] }
  | { kind: 'verify_failed'; verdict: VerifierVerdict; intents: FieldIntent[]; eeo: EeoField[] }
  | {
      kind: 'verified';
      verdict: VerifierVerdict;
      intents: FieldIntent[];
      skipped: FormField[];
      eeo: EeoField[];
      unmapped: UnmappedField[];
    };

export interface ApplicationAdapterOptions {
  /** 12-hex app id (events.appIdFor). Required for event recording to happen. */
  appId?: string;
  /** Records fill_verified / abstained. Omitted in stub demos to avoid touching the log. */
  recorder?: SubmissionRecorder;
  verifier?: Verifier;
}

export class ApplicationAdapter {
  constructor(
    private readonly source: AtsFormSource,
    private readonly answers: AnswerSource,
    private readonly opts: ApplicationAdapterOptions = {}
  ) {}

  async run(ctx: AnswerContext, resumePdfPath?: string): Promise<ApplicationOutcome> {
    if (await this.source.isAuthWall()) return { kind: 'auth_required' };

    const verifier = this.opts.verifier ?? new Verifier();
    const builder = new IntentPayloadBuilder(this.answers);

    const schema = await this.source.scanSchema();
    const payload = builder.build(schema.fields, ctx, resumePdfPath);

    // A required field whose widget the mapper does not understand cannot be
    // filled safely; it must abstain ("required unmapped must abstain").
    const unmappedReasons: AbstainReason[] = schema.unmapped
      .filter((u) => u.required)
      .map((u) => ({
        fieldId: u.id,
        label: u.label,
        why: `unknown field widget "${u.widget}" — cannot fill safely`,
      }));

    const reasons = [...payload.reasons, ...unmappedReasons];

    // A form with nothing to fill cannot be "verified": verifying zero fields
    // is a vacuous pass (every() over []), a false green and a latent empty
    // submission. Treat it as an abstain.
    if (reasons.length === 0 && payload.intents.length === 0) {
      reasons.push({
        fieldId: '(form)',
        label: 'application form',
        why: 'no fillable fields detected to verify (page may not have loaded, or all fields are EEO/unknown)',
      });
    }

    // Abstain BEFORE the first fill: no browser mutation on an uncertain form.
    if (reasons.length > 0) {
      this.record((r, appId) => r.recordAbstain(appId, reasons));
      return { kind: 'abstained', reasons, eeo: schema.eeo, unmapped: schema.unmapped };
    }

    for (const intent of payload.intents) await this.source.fill(intent);

    const readBacks: ReadBackValue[] = [];
    for (const intent of payload.intents) {
      readBacks.push({ fieldId: intent.field.id, actual: await this.source.readBack(intent.field) });
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
