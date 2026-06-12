/**
 * The independent checker (AGENTS.md invariant 2): diffs read-back reality
 * against the IntentPayload. Pure and deterministic.
 *
 * Comparison rules, by design:
 * - free text: byte equality. The filler writes exact intent values, so
 *   anything else is a fill defect. No LLM judge: an objective gate exists,
 *   so a subjective one would only add noise (spec deviation recorded in
 *   docs/specs/M2-greenhouse-adapter.md history and the test file).
 * - option fields (select/radio/multiselect): whitespace-normalized
 *   equality, because option text in the DOM often carries padding.
 * - file fields: read-back must contain the uploaded file's basename
 *   (ATSes display the filename, never the local path).
 * - an intent with no read-back, or a null read-back: FAIL. Unverified is
 *   never verified.
 */

import path from 'path';
import type { FieldIntent } from './IntentPayload.js';

export interface ReadBackValue {
  fieldId: string;
  /** null = field could not be read or was empty. */
  actual: string | null;
}

export interface FieldCheck {
  fieldId: string;
  label: string;
  expected: string;
  actual: string | null;
  pass: boolean;
}

export interface VerifierVerdict {
  pass: boolean;
  checks: FieldCheck[];
}

const OPTION_TYPES: ReadonlySet<string> = new Set(['select', 'multiselect', 'radio']);

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class Verifier {
  verify(intents: FieldIntent[], readBacks: ReadBackValue[]): VerifierVerdict {
    const actualById = new Map(readBacks.map((r) => [r.fieldId, r.actual]));

    const checks: FieldCheck[] = intents.map((intent) => {
      const actual = actualById.get(intent.field.id) ?? null;
      return {
        fieldId: intent.field.id,
        label: intent.field.label,
        expected: intent.value,
        actual,
        pass: actual !== null && this.matches(intent, actual),
      };
    });

    return { pass: checks.every((c) => c.pass), checks };
  }

  private matches(intent: FieldIntent, actual: string): boolean {
    if (intent.field.type === 'file') {
      return actual.includes(path.basename(intent.value));
    }
    if (OPTION_TYPES.has(intent.field.type)) {
      return norm(actual) === norm(intent.value);
    }
    return actual === intent.value;
  }
}
