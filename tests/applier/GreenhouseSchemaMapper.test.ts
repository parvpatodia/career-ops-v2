/**
 * SPEC M2 step 3a: Greenhouse boards-API question schema -> FormField[].
 * Fixture shape verified against the live API (see fixture __source).
 * Properties: nothing is silently dropped, option submit-values are
 * preserved, EEO/compliance sections are surfaced separately, unknown
 * field types become explicit unmapped entries.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { GreenhouseSchemaMapper } from '../../src/applier/GreenhouseSchemaMapper.js';

const RAW = JSON.parse(fs.readFileSync('tests/fixtures/greenhouse-api-job.json', 'utf8'));

describe('GreenhouseSchemaMapper', () => {
  const mapper = new GreenhouseSchemaMapper();
  const schema = mapper.map(RAW);

  it('maps text, file, and select questions to FormFields', () => {
    const byId = new Map(schema.fields.map((m) => [m.field.id, m]));

    expect(byId.get('first_name')?.field.type).toBe('text');
    expect(byId.get('first_name')?.field.required).toBe(true);
    expect(byId.get('resume')?.field.type).toBe('file');
    expect(byId.get('question_8581812008')?.field.required).toBe(false);

    const auth = byId.get('question_111')!;
    expect(auth.field.type).toBe('select');
    expect(auth.field.options).toEqual(['Yes', 'No']);
  });

  it('preserves option submit-values keyed by label', () => {
    const auth = schema.fields.find((m) => m.field.id === 'question_111')!;
    expect(auth.optionValues).toEqual({ Yes: 1, No: 0 });
  });

  it('prefers input_file over its textarea sibling in one question', () => {
    expect(schema.fields.some((m) => m.field.id === 'resume')).toBe(true);
    expect(schema.fields.some((m) => m.field.id === 'resume_text')).toBe(false);
  });

  it('maps multi_value_multi_select to multiselect', () => {
    const teams = schema.fields.find((m) => m.field.id === 'question_222')!;
    expect(teams.field.type).toBe('multiselect');
    expect(teams.field.options).toEqual(['Research', 'Engineering']);
  });

  it('surfaces unknown field types as unmapped instead of dropping them', () => {
    expect(schema.unmapped).toHaveLength(1);
    expect(schema.unmapped[0]).toMatchObject({
      label: 'Quantum readiness assessment',
      type: 'input_quantum',
      required: true,
    });
    expect(schema.fields.some((m) => m.field.id === 'question_999')).toBe(false);
  });

  it('keeps demographic EEO out of fields, routes compliance to complianceFields', () => {
    expect(schema.fields.some((m) => m.field.id === 'gender')).toBe(false); // demographic survey: not in fields
    expect(schema.hasDemographics).toBe(true);
    expect(schema.hasCompliance).toBe(true);
    // compliance questions are fillable candidates, SEPARATE from `fields` (DOM-gated later)
    expect(schema.complianceFields.some((m) => m.field.id === 'gdpr_consent')).toBe(true);
    expect(schema.fields.some((m) => m.field.id === 'gdpr_consent')).toBe(false);
  });

  it('maps EEOC compliance (Gender/Veteran) to complianceFields with options, not fields', () => {
    const job = {
      questions: [],
      compliance: [
        {
          type: 'eeoc',
          questions: [
            { label: 'Gender', required: false, fields: [{ name: 'gender', type: 'multi_value_single_select', values: [{ label: 'Decline To Self Identify', value: 0 }, { label: 'Female', value: 1 }, { label: 'Male', value: 2 }] }] },
            { label: 'Veteran Status', required: false, fields: [{ name: 'veteran_status', type: 'multi_value_single_select', values: [{ label: 'I am not a protected veteran', value: 1 }] }] },
          ],
        },
      ],
    };
    const s = new GreenhouseSchemaMapper().map(job);
    const gender = s.complianceFields.find((m) => m.field.id === 'gender')!;
    expect(gender.field.type).toBe('select');
    expect(gender.field.options).toEqual(['Decline To Self Identify', 'Female', 'Male']);
    expect(s.complianceFields.some((m) => m.field.id === 'veteran_status')).toBe(true);
    expect(s.fields).toHaveLength(0); // compliance never lands in `fields`
    expect(s.hasCompliance).toBe(true);
  });

  it('uses the question label as the FormField label', () => {
    const auth = schema.fields.find((m) => m.field.id === 'question_111')!;
    expect(auth.field.label).toBe('Are you authorized to work in the United States?');
  });
});
