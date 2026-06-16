/**
 * GenericFormSource: vendor-neutral DOM field discovery for ANY ATS, routed
 * through the normalized schema so the SAME IntentPayload + Verifier apply.
 * Fake page (no browser): scanSchema maps discovered controls; demographics ->
 * eeo (surfaced), radios -> unmapped (never guessed), login wall -> auth.
 */

import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { GenericFormSource } from '../../src/applier/GenericFormSource.js';

// A fake page whose evaluate returns canned values per call (discover, then auth).
function fakePage(discoverResult: unknown, authResult = false): Page {
  let call = 0;
  return {
    evaluate: async () => {
      call += 1;
      return call === 1 ? discoverResult : authResult; // isAuthWall called separately
    },
  } as unknown as Page;
}

const RAW = [
  { id: 'first_name', label: 'First Name *', tag: 'input', type: 'text', reactSelect: false, required: true },
  { id: 'email', label: 'Email *', tag: 'input', type: 'email', reactSelect: false, required: true },
  { id: 'phone', label: 'Phone', tag: 'input', type: 'tel', reactSelect: false, required: false },
  { id: 'resume', label: 'Resume', tag: 'input', type: 'file', reactSelect: false, required: true },
  { id: 'country', label: 'Country', tag: 'input', type: 'text', reactSelect: true, required: true },
  { id: 'cover', label: 'Why us?', tag: 'textarea', type: '', reactSelect: false, required: false },
  { id: 'gender', label: 'Gender', tag: 'input', type: 'text', reactSelect: true, required: false }, // EEO
  { id: 'start_pref', label: 'Preferred start', tag: 'input', type: 'radio', reactSelect: false, required: true }, // radio
];

describe('GenericFormSource.scanSchema', () => {
  it('discovers + types fields; routes EEO to eeo, radios to unmapped', async () => {
    const src = new GenericFormSource(fakePage(RAW), 'lever');
    const schema = await src.scanSchema();

    const byId = Object.fromEntries(schema.fields.map((f) => [f.id, f.type]));
    expect(byId).toMatchObject({
      first_name: 'text', email: 'email', phone: 'phone', resume: 'file',
      country: 'select',  // react-select
      cover: 'textarea',
    });
    // Gender -> EEO (surfaced, never auto-filled).
    expect(schema.eeo.map((e) => e.id)).toContain('gender');
    expect(schema.fields.map((f) => f.id)).not.toContain('gender');
    // Radio -> unmapped (never guessed); it was required, so it will abstain upstream.
    expect(schema.unmapped.map((u) => u.id)).toContain('start_pref');
    expect(schema.unmapped.find((u) => u.id === 'start_pref')?.required).toBe(true);
    expect(src.ats).toBe('lever');
  });

  it('returns an empty schema (not a crash) when the page has no evaluate', async () => {
    const src = new GenericFormSource({} as unknown as Page);
    const schema = await src.scanSchema();
    expect(schema.fields).toEqual([]);
  });

  it('detects a login wall as an auth wall', async () => {
    const wall = { evaluate: async () => true } as unknown as Page;
    expect(await new GenericFormSource(wall).isAuthWall()).toBe(true);
    const form = { evaluate: async () => false } as unknown as Page;
    expect(await new GenericFormSource(form).isAuthWall()).toBe(false);
  });
});
