/**
 * AnswerGenerator tests — every question category must resolve to the
 * correct value from the real profile, or be flagged appropriately.
 *
 * WHY real profile: We want to catch regressions in production data
 * (e.g. if profile.yml structure changes) not just synthetic data.
 */

import fs from 'fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { ProfileLoader } from '../../src/applier/ProfileLoader.js';
import { AnswerGenerator, fullStateName } from '../../src/applier/AnswerGenerator.js';
import type { AnswerContext } from '../../src/applier/AnswerGenerator.js';

// WHY skipIf: config/profile.yml is real personal data and gitignored, so CI
// machines never have it. Locally the suite must run against production data.
const HAS_REAL_PROFILE = fs.existsSync('config/profile.yml');

const CTX: AnswerContext = {
  company: 'OpenAI',
  role: 'ML Engineer Intern',
  resumeVariant: 'ai',
};

describe.skipIf(!HAS_REAL_PROFILE)('AnswerGenerator', () => {
  let gen: AnswerGenerator;

  beforeAll(() => {
    const loader = new ProfileLoader('config/profile.yml');
    gen = new AnswerGenerator(loader);
  });

  // ── Identity ─────────────────────────────────────────────────────────────

  it('answers first name', () => {
    const a = gen.generate('First Name', CTX);
    expect(a).not.toBeNull();
    expect(a!.value).toBe('Parv');
    expect(a!.needsReview).toBe(false);
  });

  it('answers last name', () => {
    const a = gen.generate('Last Name', CTX);
    expect(a!.value).toBe('Patodia');
    expect(a!.needsReview).toBe(false);
  });

  it('answers full name', () => {
    const a = gen.generate('Full Name', CTX);
    expect(a!.value).toBe('Parv Patodia');
  });

  it('answers email', () => {
    const a = gen.generate('Email Address', CTX);
    expect(a!.value).toBe('patodia.pa@northeastern.edu');
    expect(a!.needsReview).toBe(false);
  });

  it('answers phone', () => {
    const a = gen.generate('Phone Number', CTX);
    expect(a!.value).toBe('555-555-0142');
    expect(a!.needsReview).toBe(false);
  });

  // ── Social URLs ───────────────────────────────────────────────────────────

  it('answers LinkedIn URL with https:// prefix', () => {
    const a = gen.generate('LinkedIn URL', CTX);
    expect(a!.value).toMatch(/^https:\/\//);
    expect(a!.value).toContain('parvpatodia');
    expect(a!.value).not.toContain('https://https://');
  });

  it('answers GitHub URL with https:// prefix', () => {
    const a = gen.generate('GitHub Profile', CTX);
    expect(a!.value).toMatch(/^https:\/\//);
    expect(a!.value).toContain('parvpatodia');
  });

  // ── Education ─────────────────────────────────────────────────────────────

  it('answers university / school name', () => {
    const a = gen.generate('University Name', CTX);
    expect(a!.value).toContain('Northeastern');
  });

  it('answers degree type', () => {
    const a = gen.generate("Degree / Level of Education", CTX);
    expect(a!.value).toContain("Master");
  });

  it('answers GPA', () => {
    const a = gen.generate('GPA', CTX);
    expect(a!.value).toBe('3.917');
  });

  it('answers expected graduation', () => {
    const a = gen.generate('Expected Graduation Date', CTX);
    expect(a!.value).toContain('2027');
  });

  // ── Work Authorization ────────────────────────────────────────────────────

  it('answers "authorized to work" as Yes', () => {
    const a = gen.generate('Are you authorized to work in the United States?', CTX);
    expect(a!.value).toBe('Yes');
    expect(a!.needsReview).toBe(false);
  });

  it('answers sponsorship question with visa details and flags for review', () => {
    const a = gen.generate('Will you now or in the future require sponsorship?', CTX);
    expect(a).not.toBeNull();
    expect(a!.value).toContain('F-1');
    expect(a!.needsReview).toBe(true); // always flag sponsorship answers
  });

  // ── Availability ──────────────────────────────────────────────────────────

  it('answers start date', () => {
    const a = gen.generate('Desired Start Date', CTX);
    expect(a!.value).toBeTruthy();
    expect(a!.needsReview).toBe(false);
  });

  it('answers end date', () => {
    const a = gen.generate('Expected End Date', CTX);
    expect(a!.value).toBeTruthy();
  });

  // ── Compensation ──────────────────────────────────────────────────────────

  it('answers salary/hourly for intern role', () => {
    const a = gen.generate('Desired Hourly Rate', CTX);
    expect(a!.value).toContain('/hour');
    expect(a!.value).toContain('30');
  });

  it('answers compensation for full-time role context', () => {
    const a = gen.generate('Salary Expectations', {
      ...CTX,
      role: 'ML Engineer',
    });
    expect(a!.value).toBeTruthy();
  });

  // ── Logistics ─────────────────────────────────────────────────────────────

  it('answers how did you hear', () => {
    const a = gen.generate('How did you hear about this position?', CTX);
    expect(a!.value).toBe('LinkedIn');
  });

  it('answers relocation question', () => {
    const a = gen.generate('Are you willing to relocate?', CTX);
    expect(a!.value).toBe('Yes');
  });

  // ── Safety / Flags ────────────────────────────────────────────────────────

  it('flags ITAR / export control question for review', () => {
    const a = gen.generate(
      'Are you a US person as defined by ITAR and EAR?',
      CTX
    );
    expect(a).not.toBeNull();
    expect(a!.needsReview).toBe(true);
    expect(a!.confidence).toBe('low');
  });

  it('flags security clearance question', () => {
    const a = gen.generate('Do you hold an active security clearance?', CTX);
    expect(a).not.toBeNull();
    expect(a!.needsReview).toBe(true);
  });

  it('flags US citizenship requirement', () => {
    const a = gen.generate('Are you a US citizen?', CTX);
    expect(a).not.toBeNull();
    expect(a!.needsReview).toBe(true);
  });

  it('returns null for an unrecognized/open-ended question', () => {
    const a = gen.generate(
      'Describe a time you resolved a complex technical disagreement with a teammate',
      CTX
    );
    expect(a).toBeNull();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('is case-insensitive for question matching', () => {
    const lower = gen.generate('email address', CTX);
    const upper = gen.generate('EMAIL ADDRESS', CTX);
    expect(lower!.value).toBe(upper!.value);
  });

  it('does not confuse "company name" field with personal name field', () => {
    const a = gen.generate('Company Name', CTX);
    // Should NOT return Parv Patodia — that is the personal name
    // GenericHandler uses this for current employer
    expect(a).toBeNull(); // not a recognized identity field
  });

  // ── Location typeahead ──────────────────────────────────────────────────────

  it('answers a combined location field with "City, Full State" (typeahead-matchable)', () => {
    const a = gen.generate('Location (City)', CTX);
    expect(a!.value).toBe('San Jose, California'); // NOT "San Jose" (ambiguous) or "San Jose, CA"
  });

  it('still answers a plain "City" field with just the city', () => {
    const a = gen.generate('City', CTX);
    expect(a!.value).toBe('San Jose');
  });
});

describe('fullStateName', () => {
  it('expands a postal abbreviation to the full state name', () => {
    expect(fullStateName('CA')).toBe('California');
    expect(fullStateName('ny')).toBe('New York');
  });
  it('passes through a full name or an unknown value unchanged', () => {
    expect(fullStateName('California')).toBe('California');
    expect(fullStateName('')).toBe('');
    expect(fullStateName('Ontario')).toBe('Ontario');
  });
});
