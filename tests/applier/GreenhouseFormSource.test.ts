/**
 * SPEC M4: Greenhouse on the ATS-agnostic core. scanSchema() maps the
 * boards-API job into the same NormalizedSchema the Workday source produces,
 * so the shared ApplicationAdapter drives both portals. scanSchema does no
 * browser I/O (the schema is the API), so it is unit-tested with a stub page.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { GreenhouseFormSource } from '../../src/applier/GreenhouseFormSource.js';
import type { Page } from 'playwright';

const JOB = JSON.parse(fs.readFileSync('tests/fixtures/greenhouse-api-job.json', 'utf8'));
const stubPage = {} as unknown as Page; // scanSchema never touches the page

describe('GreenhouseFormSource.scanSchema', () => {
  it('maps boards-API questions into the normalized fillable schema', async () => {
    const schema = await new GreenhouseFormSource(stubPage, JOB).scanSchema();
    const ids = schema.fields.map((f) => f.id);

    expect(ids).toContain('first_name');
    expect(ids).toContain('email');
    expect(ids).toContain('resume');
    const auth = schema.fields.find((f) => f.id === 'question_111')!;
    expect(auth.type).toBe('select');
    expect(auth.options).toEqual(['Yes', 'No']);
  });

  it('surfaces demographic_questions as EEO, never as fillable fields', async () => {
    const schema = await new GreenhouseFormSource(stubPage, JOB).scanSchema();
    expect(schema.fields.some((f) => f.id === 'gender')).toBe(false);
    expect(schema.eeo.map((e) => e.id)).toContain('gender');
    expect(schema.eeo.find((e) => e.id === 'gender')?.label).toBe('Gender');
  });

  it('carries unknown field types into unmapped (required ones abstain upstream)', async () => {
    const schema = await new GreenhouseFormSource(stubPage, JOB).scanSchema();
    expect(schema.unmapped.some((u) => u.label === 'Quantum readiness assessment' && u.required)).toBe(true);
  });

  it('has no auth wall (public job board)', async () => {
    expect(await new GreenhouseFormSource(stubPage, JOB).isAuthWall()).toBe(false);
  });
});

describe('GreenhouseFormSource.filterBuiltins (DOM builtin discovery)', () => {
  const known = new Set(['question_111']); // already in the API schema

  it('recovers a missing required text field and the Country react-select', () => {
    const out = GreenhouseFormSource.filterBuiltins(
      [
        { id: 'country', label: 'Country', reactSelect: true, required: true, type: 'text' },
        { id: 'preferred', label: 'Preferred name', reactSelect: false, required: true, type: 'text' },
      ],
      known
    );
    expect(out.map((f) => f.id).sort()).toEqual(['country', 'preferred']);
    expect(out.find((f) => f.id === 'country')!.type).toBe('select');
  });

  it('does NOT leak multi-select checkbox/radio options as phantom fields', () => {
    // The Tenstorrent bug: "Austin, TX" / "Summer" checkboxes were discovered
    // as separate required text questions, inflating the unknown count.
    const out = GreenhouseFormSource.filterBuiltins(
      [
        { id: 'opt_austin', label: 'Austin, TX', reactSelect: false, required: true, type: 'checkbox' },
        { id: 'opt_summer', label: 'Summer', reactSelect: false, required: true, type: 'checkbox' },
        { id: 'opt_full', label: 'Full-time', reactSelect: false, required: true, type: 'radio' },
      ],
      known
    );
    expect(out).toEqual([]);
  });

  it('skips API-known fields and recaptcha/search inputs', () => {
    const out = GreenhouseFormSource.filterBuiltins(
      [
        { id: 'question_111', label: 'Work auth', reactSelect: true, required: true, type: 'text' },
        { id: 'g-recaptcha-response', label: 'recaptcha', reactSelect: false, required: true, type: 'text' },
        { id: 'search-input-x', label: 'Search', reactSelect: false, required: true, type: 'text' },
      ],
      known
    );
    expect(out).toEqual([]);
  });

  it('ignores non-required fields unless they are location fields', () => {
    const out = GreenhouseFormSource.filterBuiltins(
      [
        { id: 'opt_note', label: 'Optional note', reactSelect: false, required: false, type: 'text' },
        { id: 'loc_city', label: 'City', reactSelect: false, required: false, type: 'text' },
      ],
      known
    );
    expect(out.map((f) => f.id)).toEqual(['loc_city']);
  });
});
