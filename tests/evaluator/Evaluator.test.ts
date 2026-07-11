import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { Evaluator } from '../../src/evaluator/Evaluator.js';
import { JobParser } from '../../src/evaluator/JobParser.js';
import type { Job } from '../../src/types.js';

const SCORING_CONFIG = 'config/scoring.yml';

const BASE_JOB: Job = {
  id: 'test-001',
  title: 'ML Engineer Intern',
  company: 'TestCo',
  url: 'https://testco.com/jobs/1',
  platform: 'linkedin',
  location: 'San Francisco, CA',
  remote: false,
  postedAt: new Date().toISOString(),
  discoveredAt: new Date().toISOString(),
  jd: `
    We are looking for an ML Engineer Intern.
    Requirements: Python, PyTorch, deep learning, computer vision.
    Location: San Francisco Bay Area.
    We sponsor F-1 OPT and CPT.
    Internship position, students welcome.
  `,
  status: 'discovered',
};

// WHY skipIf: Evaluator parses real resumes from cv/, which is gitignored
// personal data, so CI machines never have it. Locally these must run.
const HAS_CV = fs.existsSync('cv/master.md');

describe.skipIf(!HAS_CV)('Evaluator', () => {
  let evaluator: Evaluator;

  beforeAll(() => {
    if (!fs.existsSync(SCORING_CONFIG)) {
      throw new Error(`scoring.yml not found at ${SCORING_CONFIG}. Run from project root.`);
    }
    evaluator = new Evaluator(SCORING_CONFIG);
  });

  it('returns a score between 0 and 100', () => {
    const result = evaluator.evaluate(BASE_JOB);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('sets shouldApply=true for high-fit job', () => {
    const result = evaluator.evaluate(BASE_JOB);
    // ML intern in Bay Area that sponsors F-1 should clear 50/100
    expect(result.shouldApply).toBe(true);
  });

  it('sets score=0 and shouldApply=false for permanent-auth-required job', () => {
    const blockedJob: Job = {
      ...BASE_JOB,
      jd: 'ML Engineer role. Requirements: Python, PyTorch. Must be authorized to work permanently in the United States. US citizen or permanent resident only.',
    };
    const result = evaluator.evaluate(blockedJob);
    expect(result.score).toBe(0);
    expect(result.shouldApply).toBe(false);
  });

  it('scores senior-level job significantly lower than intern role', () => {
    const seniorJob: Job = {
      ...BASE_JOB,
      title: 'Senior ML Engineer',
      jd: 'Senior role, 5+ years required, Python, PyTorch.',
    };
    const seniorResult = evaluator.evaluate(seniorJob);
    const internResult = evaluator.evaluate(BASE_JOB);
    // Senior experience score (0.10) vs intern (1.0) — significant gap
    expect(seniorResult.score).toBeLessThan(internResult.score);
    expect(seniorResult.breakdown.experienceMatch).toBeLessThan(
      internResult.breakdown.experienceMatch
    );
  });

  it('CALIBRATION: an off-field role at a fresh Bay-Area sponsoring posting falls BELOW the apply threshold', () => {
    // Same great context as BASE_JOB (fresh, Bay Area, sponsors F-1, intern) but
    // the ROLE is off-field. Before calibration this floated to ~90; the role-fit
    // multiplier must now drop it under min_to_apply so it is never queued.
    const offField: Job = {
      ...BASE_JOB,
      title: 'Aerodynamics Intern',
      jd: `Aerodynamics Intern. Requirements: fluid dynamics, CFD, wind tunnel testing,
           aerospace structures. San Francisco Bay Area. We sponsor F-1 OPT and CPT.
           Internship position, students welcome.`,
    };
    const off = evaluator.evaluate(offField);
    const on = evaluator.evaluate(BASE_JOB);
    expect(off.shouldApply).toBe(false);
    expect(off.score).toBeLessThan(50);
    expect(off.score).toBeLessThan(on.score - 30); // clearly separated from an on-field role
  });

  it('CALIBRATION: a generic title with an on-field JD is NOT penalized (no false-drop)', () => {
    // "Research Intern" is not an in-field TITLE, but the JD is clearly ML — the
    // JD-based signal must save it (role-fit 1.0), so it stays applyable.
    const genericOnField: Job = {
      ...BASE_JOB,
      title: 'Research Intern',
      jd: `Research Intern. You will work on machine learning and deep learning models,
           training neural networks in PyTorch for computer vision. San Francisco.
           We sponsor F-1 OPT. Students welcome.`,
    };
    const r = evaluator.evaluate(genericOnField);
    expect(r.shouldApply).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(50);
  });

  it('includes reasoning string', () => {
    const result = evaluator.evaluate(BASE_JOB);
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it('populates breakdown fields', () => {
    const result = evaluator.evaluate(BASE_JOB);
    const { breakdown } = result;
    for (const key of ['skillMatch', 'experienceMatch', 'locationMatch', 'visaMatch', 'companySignal', 'timingMatch'] as const) {
      expect(breakdown[key]).toBeGreaterThanOrEqual(0);
      expect(breakdown[key]).toBeLessThanOrEqual(100);
    }
  });

  it('selects correct resume variant for ML role', () => {
    const result = evaluator.evaluate({ ...BASE_JOB, title: 'Machine Learning Engineer' });
    expect(result.resumeVariant).toBe('ml');
  });

  it('selects correct resume variant for AI role', () => {
    const result = evaluator.evaluate({ ...BASE_JOB, title: 'AI Research Intern' });
    expect(result.resumeVariant).toBe('ai');
  });

  it('selects robotics variant', () => {
    const result = evaluator.evaluate({ ...BASE_JOB, title: 'Robotics Software Intern' });
    expect(result.resumeVariant).toBe('robotics');
  });

  it('falls back to master for generic SWE role', () => {
    const result = evaluator.evaluate({ ...BASE_JOB, title: 'Software Engineer' });
    expect(result.resumeVariant).toBe('master');
  });
});

describe('JobParser', () => {
  const parser = new JobParser();

  it('extracts Python from JD', () => {
    const parsed = parser.parse('ML Intern', 'TestCo', 'Requirements: Python, PyTorch, Docker.');
    expect(parsed.requiredSkills.map((s) => s.toLowerCase())).toContain('python');
  });

  it('detects intern level from title', () => {
    const parsed = parser.parse('ML Engineer Intern', 'TestCo', 'Internship role.');
    expect(parsed.level).toBe('intern');
  });

  it('detects senior level from title', () => {
    const parsed = parser.parse('Senior ML Engineer', 'TestCo', '5+ years required.');
    expect(parsed.level).toBe('senior');
  });

  it('detects remote from JD text', () => {
    const parsed = parser.parse('Engineer', 'Co', 'This is a fully remote position.');
    expect(parsed.remoteAllowed).toBe(true);
  });

  it('detects explicit F-1 sponsorship', () => {
    const parsed = parser.parse('Intern', 'Co', 'We sponsor F-1 OPT and CPT.');
    expect(parsed.visaMentioned).toBe('sponsors');
  });

  it('detects permanent auth requirement', () => {
    const parsed = parser.parse('Engineer', 'Co', 'Must be authorized to work permanently.');
    expect(parsed.visaMentioned).toBe('requires_permanent');
  });
});
