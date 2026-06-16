/**
 * IntentPayload: the exact list of values the system intends to put in a
 * form, built BEFORE any browser opens. The Verifier later diffs reality
 * against this list field by field.
 *
 * WHY this exists: verify-or-abstain (AGENTS.md invariant 1) needs a
 * ground truth that was fixed before filling started. v1 had no such
 * artifact, so nothing could ever be verified.
 */

import fs from 'fs';
import type { Answer, AnswerContext } from './AnswerGenerator.js';

export interface FormField {
  /** Stable identifier: ATS API field name or a DOM selector. */
  id: string;
  label: string;
  type:
    | 'text'
    | 'email'
    | 'phone'
    | 'textarea'
    | 'select'
    | 'multiselect'
    | 'radio'
    | 'checkbox'
    | 'file'
    | 'date';
  required: boolean;
  options?: string[];
}

/** Anything that can answer a form question. AnswerGenerator satisfies this;
 *  M3's AnswerKB will too (D in SOLID: the builder depends on the interface). */
export interface AnswerSource {
  generate(question: string, ctx: AnswerContext): Answer | null;
  /**
   * Re-read any file-backed state. A long-lived source reused across an
   * autopilot resume loop MUST reload after AnswerInbox.resolve writes a
   * learned answer, or it re-abstains on the same question forever
   * (LESSONS.md 2026-06-16). No-op (omit) for in-memory sources.
   */
  reload?(): void;
}

export interface FieldIntent {
  field: FormField;
  /** Exact value to set. For option fields this is the option's original text. */
  value: string;
  source: 'answer-source' | 'resume-file';
  confidence: Answer['confidence'];
}

export interface AbstainReason {
  fieldId: string;
  label: string;
  why: string;
}

export interface IntentPayloadResult {
  kind: 'ready' | 'abstain';
  intents: FieldIntent[];
  /** Optional fields left blank on purpose (no known answer, or legal/EEO). */
  skipped: FormField[];
  /** Non-empty exactly when kind is 'abstain'. */
  reasons: AbstainReason[];
}

// WHY a hard pattern list: AGENTS.md invariant 7 says legal, EEO, and
// attestation questions are answered only from human-approved entries.
// Until the AnswerKB exists (M3), confidence from any answer source is
// irrelevant for these: required -> abstain, optional -> leave blank.
const LEGAL_PATTERNS = [
  'disability', 'veteran', 'gender', 'race', 'ethnic', 'hispanic', 'latino',
  'sexual orientation', 'transgender', 'lgbt', 'criminal', 'felony',
  'conviction', 'background check', 'drug test', 'i certify', 'certify that',
  'i agree', 'attest',
];

const OPTION_TYPES: ReadonlySet<FormField['type']> = new Set(['select', 'multiselect', 'radio']);

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class IntentPayloadBuilder {
  constructor(private readonly answers: AnswerSource) {}

  build(fields: FormField[], ctx: AnswerContext, resumePdfPath?: string): IntentPayloadResult {
    const intents: FieldIntent[] = [];
    const skipped: FormField[] = [];
    const reasons: AbstainReason[] = [];

    for (const field of fields) {
      if (field.type === 'file') {
        this.resolveFile(field, resumePdfPath, intents, skipped, reasons);
        continue;
      }

      const answer = this.answers.generate(field.label, ctx);

      // Legal/EEO/attestation fields accept ONLY human-approved answers
      // (AnswerKB entries Parv wrote). Generated answers, however
      // confident, never pass this gate.
      if (this.isLegal(field.label) && !answer?.humanApproved) {
        if (field.required) {
          reasons.push({
            fieldId: field.id,
            label: field.label,
            why: 'legal/EEO/attestation question requires a human-approved answer (AGENTS.md invariant 7)',
          });
        } else {
          skipped.push(field);
        }
        continue;
      }
      if (!answer) {
        if (field.required) {
          reasons.push({ fieldId: field.id, label: field.label, why: 'no known answer (unknown question)' });
        } else {
          skipped.push(field);
        }
        continue;
      }

      if (answer.needsReview || answer.confidence === 'low') {
        reasons.push({
          fieldId: field.id,
          label: field.label,
          why: `needs review: ${answer.reason ?? `confidence ${answer.confidence}`}`,
        });
        continue;
      }

      if (OPTION_TYPES.has(field.type)) {
        this.resolveOption(field, answer, intents, reasons);
        continue;
      }

      intents.push({ field, value: answer.value, source: 'answer-source', confidence: answer.confidence });
    }

    return { kind: reasons.length > 0 ? 'abstain' : 'ready', intents, skipped, reasons };
  }

  /**
   * Exact-normalized match only. No prefix match, no substring match, no
   * first-option fallback: those are how v1 silently filled wrong values
   * (LESSONS.md 2026-06-10).
   */
  private resolveOption(
    field: FormField,
    answer: Answer,
    intents: FieldIntent[],
    reasons: AbstainReason[]
  ): void {
    const options = field.options ?? [];
    const matches = options.filter((o) => norm(o) === norm(answer.value));

    if (matches.length === 1) {
      intents.push({ field, value: matches[0]!, source: 'answer-source', confidence: answer.confidence });
      return;
    }
    reasons.push({
      fieldId: field.id,
      label: field.label,
      why:
        matches.length === 0
          ? `no exact option match for "${answer.value}" among ${options.length} options`
          : `ambiguous: ${matches.length} options match "${answer.value}"`,
    });
  }

  private resolveFile(
    field: FormField,
    resumePdfPath: string | undefined,
    intents: FieldIntent[],
    skipped: FormField[],
    reasons: AbstainReason[]
  ): void {
    if (resumePdfPath && fs.existsSync(resumePdfPath)) {
      intents.push({ field, value: resumePdfPath, source: 'resume-file', confidence: 'high' });
      return;
    }
    if (field.required) {
      reasons.push({
        fieldId: field.id,
        label: field.label,
        why: resumePdfPath ? `resume PDF missing on disk: ${resumePdfPath}` : 'resume PDF missing (no path provided)',
      });
    } else {
      skipped.push(field);
    }
  }

  private isLegal(label: string): boolean {
    const l = norm(label);
    return LEGAL_PATTERNS.some((p) => l.includes(p));
  }
}
