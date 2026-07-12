/**
 * ProfileLoader tests — validate that profile.yml is loaded, normalized, and
 * throws clear errors on bad input. All tests run from the project root so
 * config/profile.yml is always accessible.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProfileLoader } from '../../src/applier/ProfileLoader.js';

// WHY skipIf: config/profile.yml is real personal data and gitignored, so CI
// machines never have it. Locally these real-profile checks must run.
const HAS_REAL_PROFILE = fs.existsSync('config/profile.yml');

// Helpers ------------------------------------------------------------------
function writeTemp(content: string): string {
  const f = path.join(os.tmpdir(), `profile-test-${Date.now()}.yml`);
  fs.writeFileSync(f, content);
  return f;
}

const MINIMAL_PROFILE = `
identity:
  name: "Test User"
  email: "test@example.com"
  phone: "415-000-0000"
  linkedin: "linkedin.com/in/testuser"
  github: "github.com/testuser"
  city: "San Francisco"
  state: "CA"
  zip: "94105"
  address: "123 Main St"
  university: "Test University"
  program: "MS Computer Science"
  gpa: 3.9
  graduation: "May 2026"
work_authorization:
  visa_type: "F-1"
  authorized_to_work_now: true
  requires_sponsorship_now: false
  requires_sponsorship_future: true
  sponsorship_answer: "F-1 CPT — no sponsorship now."
compensation:
  internship_hourly_target: 45
  internship_hourly_min: 30
  internship_hourly_max: 65
  fulltime_annual_target: 140000
  fulltime_annual_min: 110000
  fulltime_annual_max: 180000
target_roles:
  start_date: "2026-05-11"
application_defaults:
  how_did_you_hear: "LinkedIn"
  about_me_short: "Short bio."
  background_check_consent: true
  drug_test_consent: true
`;

// Tests --------------------------------------------------------------------

describe('ProfileLoader', () => {
  it.skipIf(!HAS_REAL_PROFILE)('loads the real project profile without throwing', () => {
    // If this throws, the real config is broken — that IS the test.
    expect(() => new ProfileLoader('config/profile.yml')).not.toThrow();
  });

  it('throws a clear error when profile file does not exist', () => {
    expect(() => new ProfileLoader('/tmp/does-not-exist.yml')).toThrow(/not found/i);
  });

  it('throws a clear error when identity section is missing', () => {
    const f = writeTemp('target_roles:\n  start_date: "2026-05-11"\n');
    expect(() => new ProfileLoader(f)).toThrow(/identity/i);
    fs.unlinkSync(f);
  });

  it('throws a clear error when required identity field is missing', () => {
    const f = writeTemp(
      'identity:\n  name: "Test"\n  email: "t@t.com"\n  phone: ""\n  linkedin: "l"\n  github: "g"\n'
    );
    // phone is empty string — should throw
    expect(() => new ProfileLoader(f)).toThrow(/phone/i);
    fs.unlinkSync(f);
  });

  it('returns correct firstName and lastName', () => {
    const f = writeTemp(MINIMAL_PROFILE);
    const loader = new ProfileLoader(f);
    const id = loader.getIdentity();
    expect(id.firstName).toBe('Test');
    expect(id.lastName).toBe('User');
    fs.unlinkSync(f);
  });

  it('prepends https:// to LinkedIn URL that lacks a protocol', () => {
    const f = writeTemp(MINIMAL_PROFILE);
    const loader = new ProfileLoader(f);
    const id = loader.getIdentity();
    expect(id.linkedin).toBe('https://linkedin.com/in/testuser');
    fs.unlinkSync(f);
  });

  it('does NOT double-prepend https:// if protocol already present', () => {
    const profile = MINIMAL_PROFILE.replace(
      '"linkedin.com/in/testuser"',
      '"https://linkedin.com/in/testuser"'
    );
    const f = writeTemp(profile);
    const loader = new ProfileLoader(f);
    const id = loader.getIdentity();
    expect(id.linkedin).toBe('https://linkedin.com/in/testuser');
    expect(id.linkedin).not.toContain('https://https://');
    fs.unlinkSync(f);
  });

  it('returns null portfolio when portfolio is null in YAML', () => {
    const profile = MINIMAL_PROFILE + '\n  portfolio: null\n';
    const f = writeTemp(profile);
    const loader = new ProfileLoader(f);
    expect(loader.getIdentity().portfolio).toBeNull();
    fs.unlinkSync(f);
  });

  it('returns correct work authorization fields', () => {
    const f = writeTemp(MINIMAL_PROFILE);
    const loader = new ProfileLoader(f);
    const wa = loader.getWorkAuth();
    expect(wa.visaType).toBe('F-1');
    expect(wa.authorizedNow).toBe(true);
    expect(wa.requiresSponsorshipNow).toBe(false);
    expect(wa.requiresSponsorshipFuture).toBe(true);
    expect(wa.sponsorshipAnswer).toContain('CPT');
    fs.unlinkSync(f);
  });

  it('returns correct compensation fields', () => {
    const f = writeTemp(MINIMAL_PROFILE);
    const loader = new ProfileLoader(f);
    const comp = loader.getCompensation();
    expect(comp.internshipHourlyMin).toBe(30);
    expect(comp.internshipHourlyMax).toBe(65);
    expect(comp.fulltimeAnnualTarget).toBe(140000);
    fs.unlinkSync(f);
  });

  it('computes endDate as August 15 for a May start date', () => {
    const f = writeTemp(MINIMAL_PROFILE);
    const loader = new ProfileLoader(f);
    const d = loader.getApplicationDefaults();
    expect(d.endDate).toBe('2026-08-15');
    fs.unlinkSync(f);
  });

  // Regression: the target term must come from profile, never hardcoded in
  // source (a hardcoded season silently goes stale, e.g. "Summer 2026").
  it('reads term from target_roles.terms[0]', () => {
    const withTerms = MINIMAL_PROFILE.replace(
      'target_roles:\n  start_date: "2026-05-11"',
      'target_roles:\n  start_date: "2026-08-17"\n  terms:\n    - "Fall 2026"\n    - "Spring 2027"'
    );
    const f = writeTemp(withTerms);
    const loader = new ProfileLoader(f);
    expect(loader.getApplicationDefaults().term).toBe('Fall 2026');
    fs.unlinkSync(f);
  });

  it('defaults term to Fall 2026 when target_roles.terms is absent', () => {
    const f = writeTemp(MINIMAL_PROFILE);   // MINIMAL_PROFILE has start_date but no terms
    const loader = new ProfileLoader(f);
    expect(loader.getApplicationDefaults().term).toBe('Fall 2026');
    fs.unlinkSync(f);
  });

  it.skipIf(!HAS_REAL_PROFILE)('real profile has correct name and email', () => {
    const loader = new ProfileLoader('config/profile.yml');
    const id = loader.getIdentity();
    expect(id.name).toBe('Parv Patodia');
    expect(id.email).toBe('patodia.pa@northeastern.edu');
    expect(id.linkedin).toContain('https://');
    expect(id.linkedin).not.toContain('https://https://');
  });
});
