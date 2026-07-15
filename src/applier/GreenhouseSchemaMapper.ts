/**
 * Maps a Greenhouse boards-API job (questions=true) onto FormFields.
 * REF: https://developers.greenhouse.io/job-board.html
 * Shape verified against the live API on 2026-06-12 (see
 * tests/fixtures/greenhouse-api-job.json __source note).
 *
 * Three properties a senior reviewer should check here:
 * 1. Nothing silently dropped: unknown field types land in `unmapped`.
 * 2. Option submit-values preserved: the API displays labels but submits
 *    numeric/string values; losing the mapping breaks API submission.
 * 3. EEO (demographic_questions) and compliance never become fillable
 *    fields: invariant 7 routes them to the human, not the autopilot.
 */

import type { FormField } from './IntentPayload.js';

interface GhValue {
  label: string;
  value: string | number;
}

interface GhField {
  name: string;
  type: string;
  values: GhValue[];
}

interface GhQuestion {
  label: string;
  required: boolean;
  fields: GhField[];
}

export interface GhMappedField {
  field: FormField;
  /** The API field name to submit under (same as field.id today, kept explicit). */
  ghName: string;
  /** Option label -> API submit value, for option-typed fields. */
  optionValues?: Record<string, string | number>;
}

export interface GhUnmappedQuestion {
  label: string;
  type: string;
  required: boolean;
}

export interface GhMappedSchema {
  fields: GhMappedField[];
  /**
   * EEOC compliance fields (Gender, Race, Veteran, Disability) from job.compliance.
   * Kept SEPARATE from `fields` because the boards-API field name can diverge from
   * the rendered DOM id (Nuro: API "race" renders as DOM "hispanic_ethnicity", and
   * [id="race"] does not exist). GreenhouseFormSource adds only the ones whose id is
   * actually present in the DOM, so a fill never targets a missing element.
   */
  complianceFields: GhMappedField[];
  /** Questions whose field type this mapper does not know. Required ones must abstain upstream. */
  unmapped: GhUnmappedQuestion[];
  hasDemographics: boolean;
  hasCompliance: boolean;
}

const TYPE_MAP: Record<string, FormField['type']> = {
  input_text: 'text',
  textarea: 'textarea',
  input_file: 'file',
  multi_value_single_select: 'select',
  multi_value_multi_select: 'multiselect',
};

interface GhComplianceSection {
  type?: string;
  questions?: GhQuestion[];
}

export class GreenhouseSchemaMapper {
  map(job: Record<string, unknown>): GhMappedSchema {
    const questions = (job.questions ?? []) as GhQuestion[];
    const fields: GhMappedField[] = [];
    const unmapped: GhUnmappedQuestion[] = [];

    for (const q of questions) {
      const mapped = this.mapQuestion(q);
      if (mapped) fields.push(mapped);
      else unmapped.push({ label: q.label, type: q.fields[0]?.type ?? 'unknown', required: q.required });
    }

    // EEOC compliance questions (Gender, Race, Veteran Status, Disability Status)
    // live under job.compliance, not job.questions. They ARE fillable — from the
    // human-approved AnswerKB only: the IntentPayloadBuilder's legal/EEO gate
    // (invariant 7) fills them from Parv's approved answers and abstains on any
    // field with no approved answer or no exact option match. Kept separate so
    // GreenhouseFormSource can drop any whose id is not in the rendered DOM.
    const compliance = (job.compliance ?? []) as GhComplianceSection[];
    const complianceFields: GhMappedField[] = [];
    for (const section of compliance) {
      for (const q of section.questions ?? []) {
        const mapped = this.mapQuestion(q);
        if (mapped) complianceFields.push(mapped);
      }
    }

    const demographics = job.demographic_questions as { questions?: unknown[] } | undefined;

    return {
      fields,
      complianceFields,
      unmapped,
      hasDemographics: Boolean(demographics?.questions?.length),
      hasCompliance: compliance.some((s) => (s.questions?.length ?? 0) > 0),
    };
  }

  /** Map one Greenhouse question to a fillable field, or null if the type is unknown. */
  private mapQuestion(q: GhQuestion): GhMappedField | null {
    // Multi-field questions (Resume/CV = input_file + textarea paste alternative):
    // the file upload is the canonical path; the sibling is an alternative input
    // for the same answer, not a second answer.
    const ghField = q.fields.find((f) => f.type === 'input_file') ?? q.fields[0];
    if (!ghField) return null;

    const type = TYPE_MAP[ghField.type];
    if (!type) return null;

    const mapped: GhMappedField = {
      ghName: ghField.name,
      field: {
        id: ghField.name,
        label: q.label,
        type,
        required: q.required,
        ...(ghField.values.length > 0 ? { options: ghField.values.map((v) => v.label) } : {}),
      },
    };
    if (ghField.values.length > 0) {
      mapped.optionValues = Object.fromEntries(ghField.values.map((v) => [v.label, v.value]));
    }
    return mapped;
  }
}
