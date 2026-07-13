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

// The single affirmative vocabulary shared by the filler (decides whether to
// check a box) and the checker (decides whether a checked box matches the
// intent). Kept here, with the comparison, so the two can never drift apart.
const AFFIRMATIVE: ReadonlySet<string> = new Set([
  'yes', 'true', 'on', '1', 'checked', 'agree', 'i agree', 'accept', 'i accept',
  'acknowledge', 'consent',
]);

/** True when a free-text answer means "checked/affirmed" for a boolean field. */
export function isAffirmative(value: string): boolean {
  return AFFIRMATIVE.has(norm(value));
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
    if (intent.field.type === 'phone' || /\b(phone|mobile|telephone|cell)\b/i.test(intent.field.label)) {
      // Forms reformat phone numbers (strip dashes, add +1). Compare by digits:
      // "408-401-9856" filled, read back "4084019856" is the SAME number.
      const digits = (s: string) => s.replace(/\D/g, '');
      const a = digits(actual);
      const e = digits(intent.value);
      return a === e || a.endsWith(e) || e.endsWith(a);
    }
    if (intent.field.type === 'checkbox') {
      // A checkbox is boolean: the read-back ("Yes"/"No") matches the intent
      // when both sides agree on affirmed-ness, not byte-for-byte.
      return isAffirmative(actual) === isAffirmative(intent.value);
    }
    if (OPTION_TYPES.has(intent.field.type)) {
      const a = norm(actual);
      const e = norm(intent.value);
      if (a === e) return true;
      // A searchable/typeahead select shows the fully-qualified option: typing
      // "San Jose, California" selects "San Jose, California, United States".
      // Accept when the read-back is the intent followed by a COMMA-qualifier,
      // so it is unambiguously the same choice. The comma anchor is deliberate:
      // it must NOT accept "United States Minor Outlying Islands" for "United
      // States" (that is a SPACE continuation, a different place) — never widen
      // this to a bare prefix/substring (invariant 1; LESSONS 2026-06-19).
      return a.startsWith(e + ', ');
    }
    return actual === intent.value;
  }
}
