/**
 * Maps raw Workday DOM field descriptors onto FormFields.
 *
 * WHY a pure mapper (not DOM code): Greenhouse gets an authoritative field
 * schema from the boards API; Workday has none, so the schema is read from
 * the React SPA's `data-automation-id` attributes. The browser-side scan
 * (WorkdayDriver) returns raw descriptors ONLY; every interpretation that can
 * be wrong lives here, where it is unit-testable without a browser. Mirrors
 * GreenhouseSchemaMapper deliberately.
 *
 * Three properties a senior reviewer should check (same as Greenhouse):
 * 1. Nothing silently dropped: an unknown widget type lands in `unmapped`,
 *    never vanishes. A required unmapped field forces an upstream abstain.
 * 2. Option texts preserved for select/multiselect/radio, so the exact-match
 *    matcher in IntentPayloadBuilder has the real option list.
 * 3. EEO / self-identification fields are routed to `eeo[]`, NEVER to fillable
 *    `fields[]` (AGENTS.md invariant 7). This is the structural parallel to
 *    Greenhouse keeping demographic_questions out of fields. IntentPayload's
 *    LEGAL_PATTERNS gate is the second, label-based net; both error directions
 *    here are safe-by-abstain (miss -> builder abstains; over-match -> field
 *    is skipped for the human, never filled wrong).
 */

import type { FormField } from './IntentPayload.js';

export interface WorkdayRawField {
  /** data-automation-id value: the stable selector key the driver locates by. */
  automationId: string;
  /** Visible label text (from <label>, aria-label, or legend). */
  label: string;
  /** Coarse DOM widget kind discovered on the page. Unknown kinds are surfaced, not dropped. */
  widget: string;
  required: boolean;
  /** Visible option texts for dropdown/multiselect/radio. */
  options?: string[];
  /** Nearest containing section's automation-id, if any (used for EEO routing). */
  section?: string;
}

export interface WorkdayMappedField {
  field: FormField;
  /** The data-automation-id to fill/read under (equals field.id today, kept explicit). */
  automationId: string;
}

export interface WorkdayUnmappedField {
  automationId: string;
  label: string;
  widget: string;
  required: boolean;
}

export interface WorkdayEeoField {
  automationId: string;
  label: string;
}

export interface WorkdayMappedSchema {
  fields: WorkdayMappedField[];
  /** Self-identification fields, surfaced for the human, never auto-filled. */
  eeo: WorkdayEeoField[];
  /** Widget types this mapper does not know. Required ones must abstain upstream. */
  unmapped: WorkdayUnmappedField[];
  hasEEO: boolean;
}

// Workday widget kind -> FormField type. Unknown kinds become `unmapped`.
const WIDGET_MAP: Record<string, FormField['type']> = {
  text: 'text',
  email: 'email',
  tel: 'phone',
  phone: 'phone',
  textarea: 'textarea',
  file: 'file',
  checkbox: 'checkbox',
  radio: 'radio',
  dropdown: 'select',
  select: 'select',
  multiselect: 'multiselect',
  date: 'date',
};

// Structural / strong demographic markers, matched against an
// alphanumeric-only haystack of automationId + section + label.
const EEO_TOKENS = [
  'selfidentif', 'voluntaryself', 'voluntarydisclosure', 'eeo', 'demographic',
  'gender', 'ethnic', 'hispanic', 'latino', 'veteran', 'disability',
  'disabilities', 'sexualorientation', 'transgender', 'lgbt',
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lowercase, strip everything but a-z0-9, so `Self_Identification` -> `selfidentification`. */
function normId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export class WorkdaySchemaMapper {
  map(raw: WorkdayRawField[]): WorkdayMappedSchema {
    const fields: WorkdayMappedField[] = [];
    const eeo: WorkdayEeoField[] = [];
    const unmapped: WorkdayUnmappedField[] = [];

    for (const r of raw) {
      if (this.isEeo(r)) {
        eeo.push({ automationId: r.automationId, label: r.label });
        continue;
      }

      const type = WIDGET_MAP[r.widget.toLowerCase()];
      if (!type) {
        unmapped.push({
          automationId: r.automationId,
          label: r.label,
          widget: r.widget,
          required: r.required,
        });
        continue;
      }

      fields.push({
        automationId: r.automationId,
        field: {
          id: r.automationId,
          label: r.label,
          type,
          required: r.required,
          ...(r.options && r.options.length > 0 ? { options: r.options } : {}),
        },
      });
    }

    return { fields, eeo, unmapped, hasEEO: eeo.length > 0 };
  }

  private isEeo(r: WorkdayRawField): boolean {
    const hay = normId(r.automationId) + normId(r.section ?? '') + normId(r.label);
    if (EEO_TOKENS.some((t) => hay.includes(t))) return true;
    // 'race' is too short to match an id substring safely; require a whole word in the label.
    return /\brace\b/.test(norm(r.label));
  }
}
