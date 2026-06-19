/**
 * AttendedFiller: the human-in-the-loop fill. Where the autonomous
 * ApplicationAdapter abstains the WHOLE form if any required field is unknown
 * (all-or-nothing, so it can submit safely), the AttendedFiller does the
 * opposite split for a human-attended session:
 *
 *   - fill ONLY the known, gated IntentPayload fields (each already passed the
 *     legal/EEO + option-match + confidence gate),
 *   - read every filled field back and verify it INDIVIDUALLY,
 *   - leave the unknown / self-ID / unsupported fields for the human,
 *   - NEVER submit.
 *
 * Accuracy guarantee (paramount): the system fills nothing it cannot confirm.
 * A field is either filled-and-verified, or flagged as verify-failed (read-back
 * mismatch — the human must fix it), or handed to the human (unknown/EEO/
 * unmapped). There is no "filled but unchecked" state. The human completes the
 * blanks, solves any captcha, and clicks submit; the inbox tracker then confirms.
 */

import { IntentPayloadBuilder } from './IntentPayload.js';
import type { AnswerSource } from './IntentPayload.js';
import type { AnswerContext } from './AnswerGenerator.js';
import { Verifier } from './Verifier.js';
import type { ReadBackValue } from './Verifier.js';
import type { AtsFormSource } from './ApplicationAdapter.js';

export interface FilledField {
  label: string;
  value: string;
  readBack: string | null;
  verified: boolean;
}

export interface HumanField {
  label: string;
  why: string;
}

export type AttendedResult =
  | { kind: 'auth_required' }
  | {
      kind: 'filled';
      /** Fields the system filled AND verified by read-back. */
      verified: FilledField[];
      /** Fields the system filled but whose read-back did NOT match (human must fix). */
      verifyFailed: FilledField[];
      /** Fields the system did NOT touch — the human must complete these. */
      needsHuman: HumanField[];
    };

export class AttendedFiller {
  constructor(
    private readonly source: AtsFormSource,
    private readonly answers: AnswerSource,
    private readonly verifier: Verifier = new Verifier()
  ) {}

  async fill(ctx: AnswerContext, resumePdfPath?: string): Promise<AttendedResult> {
    if (await this.source.isAuthWall()) return { kind: 'auth_required' };

    const schema = await this.source.scanSchema();
    const payload = new IntentPayloadBuilder(this.answers).build(schema.fields, ctx, resumePdfPath);

    // Fill ONLY the confident, gated intents — never the unknowns.
    for (const intent of payload.intents) await this.source.fill(intent);

    const readBacks: ReadBackValue[] = [];
    for (const intent of payload.intents) {
      readBacks.push({ fieldId: intent.field.id, actual: await this.source.readBack(intent.field) });
    }
    const verdict = this.verifier.verify(payload.intents, readBacks);

    const filled: FilledField[] = payload.intents.map((intent) => {
      const check = verdict.checks.find((c) => c.fieldId === intent.field.id);
      return {
        label: intent.field.label,
        value: intent.value,
        readBack: check?.actual ?? null,
        verified: check?.pass ?? false,
      };
    });

    const needsHuman: HumanField[] = [
      // A captcha is the human's to solve (invariant 6); the rest is still filled.
      ...(schema.captcha ? [{ label: `Captcha (${schema.captcha.kind})`, why: 'solve it in the browser before you submit' }] : []),
      // Unknown / needs-review questions the gate refused to guess.
      ...payload.reasons.map((r) => ({ label: r.label, why: r.why })),
      // Self-identification: surfaced, never auto-filled (invariant 7).
      ...schema.eeo.map((e) => ({ label: e.label, why: 'self-identification — your choice' })),
      // Required widgets the mapper can't fill safely (e.g. multi-select groups).
      ...schema.unmapped.filter((u) => u.required).map((u) => ({ label: u.label, why: `unsupported widget (${u.widget})` })),
    ];

    return {
      kind: 'filled',
      verified: filled.filter((f) => f.verified),
      verifyFailed: filled.filter((f) => !f.verified),
      needsHuman,
    };
  }
}
