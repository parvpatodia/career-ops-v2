/**
 * SPEC M3: Workday DOM field descriptors -> FormField[]. Mirrors the
 * GreenhouseSchemaMapper properties: nothing is silently dropped (unknown
 * widgets become unmapped), option texts are preserved, and EEO /
 * self-identification fields are routed out of the fillable set entirely.
 */

import { describe, it, expect } from 'vitest';
import { WorkdaySchemaMapper } from '../../src/applier/WorkdaySchemaMapper.js';
import type { WorkdayRawField } from '../../src/applier/WorkdaySchemaMapper.js';

const mapper = new WorkdaySchemaMapper();

function raw(p: Partial<WorkdayRawField> & { automationId: string; widget: string }): WorkdayRawField {
  return { label: p.automationId, required: false, ...p };
}

describe('WorkdaySchemaMapper', () => {
  it('maps text, email, phone, file, and dropdown widgets to FormFields', () => {
    const schema = mapper.map([
      raw({ automationId: 'legalNameSection_firstName', label: 'First Name', widget: 'text', required: true }),
      raw({ automationId: 'email', label: 'Email', widget: 'email', required: true }),
      raw({ automationId: 'phone-number', label: 'Phone', widget: 'tel' }),
      raw({ automationId: 'file-upload-input', label: 'Resume', widget: 'file' }),
      raw({ automationId: 'workAuth', label: 'Authorized to work in the US?', widget: 'dropdown', options: ['Yes', 'No'], required: true }),
    ]);

    const byId = new Map(schema.fields.map((m) => [m.field.id, m]));
    expect(byId.get('legalNameSection_firstName')?.field.type).toBe('text');
    expect(byId.get('legalNameSection_firstName')?.field.required).toBe(true);
    expect(byId.get('email')?.field.type).toBe('email');
    expect(byId.get('phone-number')?.field.type).toBe('phone');
    expect(byId.get('file-upload-input')?.field.type).toBe('file');
    expect(byId.get('workAuth')?.field.type).toBe('select');
  });

  it('preserves option texts for option-typed fields', () => {
    const schema = mapper.map([
      raw({ automationId: 'workAuth', label: 'Work auth', widget: 'dropdown', options: ['Yes', 'No'], required: true }),
    ]);
    expect(schema.fields[0]!.field.options).toEqual(['Yes', 'No']);
  });

  it('keeps the data-automation-id as both field.id and the explicit selector key', () => {
    const schema = mapper.map([raw({ automationId: 'email', label: 'Email', widget: 'email' })]);
    expect(schema.fields[0]!.field.id).toBe('email');
    expect(schema.fields[0]!.automationId).toBe('email');
  });

  it('surfaces an unknown widget type as unmapped instead of dropping it', () => {
    const schema = mapper.map([
      raw({ automationId: 'email', label: 'Email', widget: 'email' }),
      raw({ automationId: 'signaturePad', label: 'Draw your signature', widget: 'canvas-signature', required: true }),
    ]);
    expect(schema.unmapped).toHaveLength(1);
    expect(schema.unmapped[0]).toMatchObject({
      automationId: 'signaturePad',
      widget: 'canvas-signature',
      required: true,
    });
    expect(schema.fields.some((m) => m.field.id === 'signaturePad')).toBe(false);
  });

  it('routes EEO fields detected by section/automation-id out of fillable fields', () => {
    const schema = mapper.map([
      raw({ automationId: 'email', label: 'Email', widget: 'email' }),
      raw({ automationId: 'Self_Identify_gender', label: 'Gender', widget: 'dropdown', options: ['Male', 'Female'], section: 'voluntaryDisclosures' }),
      raw({ automationId: 'disabilityStatus', label: 'Disability status', widget: 'dropdown', options: ['Yes', 'No'] }),
    ]);

    expect(schema.fields.map((m) => m.field.id)).toEqual(['email']);
    expect(schema.eeo.map((e) => e.automationId).sort()).toEqual(['Self_Identify_gender', 'disabilityStatus']);
    expect(schema.hasEEO).toBe(true);
  });

  it('routes a "race" question (whole word in the label) out of fillable fields', () => {
    const schema = mapper.map([
      raw({ automationId: 'q123', label: 'What is your race?', widget: 'dropdown', options: ['A', 'B'] }),
    ]);
    expect(schema.fields).toHaveLength(0);
    expect(schema.eeo).toHaveLength(1);
  });

  it('does not false-route a non-EEO field whose label merely contains "race" inside a word', () => {
    const schema = mapper.map([
      raw({ automationId: 'q456', label: 'Do you embrace our values?', widget: 'dropdown', options: ['Yes', 'No'] }),
    ]);
    expect(schema.fields).toHaveLength(1);
    expect(schema.eeo).toHaveLength(0);
  });

  it('routes a pronouns question out of fillable fields (voluntary self-ID)', () => {
    const schema = mapper.map([
      raw({ automationId: 'pronouns', label: 'Preferred pronouns', widget: 'dropdown', options: ['He/Him', 'She/Her'] }),
    ]);
    expect(schema.fields).toHaveLength(0);
    expect(schema.eeo.map((e) => e.automationId)).toEqual(['pronouns']);
  });

  it('routes radio widgets to unmapped (radio fill not supported, never guessed)', () => {
    const schema = mapper.map([
      raw({ automationId: 'commute', label: 'Commute method', widget: 'radio', required: true, options: ['Car', 'Bus'] }),
    ]);
    expect(schema.fields).toHaveLength(0);
    expect(schema.unmapped.map((u) => u.automationId)).toEqual(['commute']);
  });

  it('reports hasEEO false when no self-identification fields are present', () => {
    const schema = mapper.map([raw({ automationId: 'email', label: 'Email', widget: 'email' })]);
    expect(schema.hasEEO).toBe(false);
    expect(schema.eeo).toHaveLength(0);
  });
});
