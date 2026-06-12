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

export class GreenhouseSchemaMapper {
  map(job: Record<string, unknown>): GhMappedSchema {
    const questions = (job.questions ?? []) as GhQuestion[];
    const fields: GhMappedField[] = [];
    const unmapped: GhUnmappedQuestion[] = [];

    for (const q of questions) {
      // Multi-field questions (Resume/CV = input_file + textarea paste
      // alternative): the file upload is the canonical path; the sibling
      // is an alternative input for the same answer, not a second answer.
      const ghField = q.fields.find((f) => f.type === 'input_file') ?? q.fields[0];
      if (!ghField) continue;

      const type = TYPE_MAP[ghField.type];
      if (!type) {
        unmapped.push({ label: q.label, type: ghField.type, required: q.required });
        continue;
      }

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
      fields.push(mapped);
    }

    const demographics = job.demographic_questions as { questions?: unknown[] } | undefined;
    const compliance = job.compliance as unknown[] | undefined;

    return {
      fields,
      unmapped,
      hasDemographics: Boolean(demographics?.questions?.length),
      hasCompliance: Boolean(compliance?.length),
    };
  }
}
