/**
 * SPEC M7: the F-1 eligibility gate + Application -> Job reconstruction the `run`
 * CLI relies on. Pure, so the safety-critical logic is tested directly.
 */

import { describe, it, expect } from 'vitest';
import { isIneligible, isRelevantRole, roleRelevance, jobFromApp, parseNotes, triageForm } from '../../src/orchestrator/queuePlanning.js';
import type { Application } from '../../src/types.js';

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: '001', jobId: 'gh-1', date: '2026-06-10', company: 'Globex', role: 'ML Engineer Intern',
    score: 80, url: 'https://boards.greenhouse.io/globex/jobs/1', status: 'Ready', resumeVariant: 'ml',
    notes: 'greenhouse | San Jose, CA', jd: 'Build ML systems.', ...overrides,
  };
}

describe('isIneligible (F-1 gate)', () => {
  it.each([
    'Must be a US Citizen',
    'requires Security Clearance',
    'ITAR-controlled program',
    'U.S. Person required for export control',
    'TS/SCI eligible',
  ])('flags an ineligible role: %s', (role) => {
    expect(isIneligible(app({ role }))).toBe(true);
  });

  it('matches ineligibility text in company or notes too', () => {
    expect(isIneligible(app({ role: 'ML Intern', notes: 'direct | requires US Citizen' }))).toBe(true);
  });

  it('passes an ordinary intern role', () => {
    expect(isIneligible(app({ role: 'Machine Learning Intern', company: 'Globex', notes: 'greenhouse | Remote' }))).toBe(false);
  });
});

describe('parseNotes', () => {
  it('splits "platform | location"', () => {
    expect(parseNotes('lever | New York, NY')).toEqual({ platform: 'lever', location: 'New York, NY' });
  });
  it('defaults a missing platform/location safely', () => {
    expect(parseNotes('')).toEqual({ platform: 'direct', location: '' });
  });
});

describe('jobFromApp reconstruction', () => {
  it('rebuilds a Job keyed identically to the queued application', () => {
    const { job, evaluation } = jobFromApp(app());
    // company + title must match so appIdFor(company, role) is the SAME key.
    expect(job.company).toBe('Globex');
    expect(job.title).toBe('ML Engineer Intern');
    expect(job.platform).toBe('greenhouse');
    expect(job.location).toBe('San Jose, CA');
    expect(job.jd).toBe('Build ML systems.');
    expect(job.applyUrl).toBe('https://boards.greenhouse.io/globex/jobs/1');

    expect(evaluation.resumeVariant).toBe('ml');
    expect(evaluation.score).toBe(80);
    expect(evaluation.shouldApply).toBe(true);
    // Cover-letter generation is off (no synthesized paragraphs); resume still tailors.
    expect(evaluation.shouldGenerateCoverLetter).toBe(false);
  });

  it('marks remote from the location note', () => {
    expect(jobFromApp(app({ notes: 'lever | Remote - US' })).job.remote).toBe(true);
    expect(jobFromApp(app({ notes: 'lever | San Jose, CA' })).job.remote).toBe(false);
  });
});

describe('triageForm (AUTO vs ATTENDED)', () => {
  const clean = { hasCaptcha: false, requiredUnmapped: 0, unknownQuestions: 0, fillableFields: 5 };

  it('is AUTO only when nothing needs a human', () => {
    const v = triageForm(clean);
    expect(v.mode).toBe('auto');
    expect(v.reasons).toEqual([]);
  });

  it('a captcha forces ATTENDED', () => {
    expect(triageForm({ ...clean, hasCaptcha: true }).mode).toBe('attended');
  });

  it('a required unmapped widget forces ATTENDED', () => {
    expect(triageForm({ ...clean, requiredUnmapped: 1 }).mode).toBe('attended');
  });

  it('an unknown question forces ATTENDED', () => {
    expect(triageForm({ ...clean, unknownQuestions: 2 }).mode).toBe('attended');
  });

  it('no fillable fields forces ATTENDED (an empty payload abstains)', () => {
    expect(triageForm({ ...clean, fillableFields: 0 }).mode).toBe('attended');
  });

  it('reports every blocking reason', () => {
    const v = triageForm({ hasCaptcha: true, requiredUnmapped: 1, unknownQuestions: 1, fillableFields: 0 });
    expect(v.reasons).toHaveLength(4);
  });
});

describe('isRelevantRole', () => {
  it('keeps AI/ML/SWE/robotics/AV roles in Parv\'s field', () => {
    for (const t of [
      'Machine Learning Engineer Intern', 'AI Research Scientist', 'Software Engineer, New Grad',
      'Software Developer Co-op', 'Robotics Perception Intern', 'Autonomous Vehicle Engineer',
      'Deep Learning Research Engineer', 'Data Scientist Intern', 'Applied Scientist, NLP',
      'Computer Vision Engineer', 'Reinforcement Learning Intern', 'Self-Driving Software Intern',
    ]) {
      expect(isRelevantRole(t)).toBe(true);
    }
  });

  it('drops off-field roles (the ROLE matters, not the company)', () => {
    for (const t of [
      'Aerodynamics Intern', 'Accounting Intern', 'Marketing Intern', 'Sales Development Rep',
      'Recruiting Coordinator', 'Mechanical Design Intern', 'Financial Analyst Intern',
    ]) {
      expect(isRelevantRole(t)).toBe(false);
    }
  });

  it('word boundaries prevent short-token false matches (ai/ml/swe)', () => {
    // "ai"/"ml" appear INSIDE these words but must not match.
    expect(isRelevantRole('Training Program Coordinator')).toBe(false); // "training" contains ai
    expect(isRelevantRole('Email Marketing Specialist')).toBe(false);   // "email" contains ai
    expect(isRelevantRole('Film Production Intern')).toBe(false);       // "film" contains ml? no; sanity
    // but real standalone tokens match:
    expect(isRelevantRole('AI Engineer')).toBe(true);
    expect(isRelevantRole('ML Infrastructure Intern')).toBe(true);
  });
});

describe('roleRelevance (scorer calibration multiplier)', () => {
  it('is 1.0 when the TITLE is on-field, regardless of JD', () => {
    expect(roleRelevance('ML Engineer Intern', '')).toBe(1.0);
    expect(roleRelevance('Software Engineer, New Grad', 'anything')).toBe(1.0);
  });

  it('saves a generic title when the JD has >=2 field signals (no false-drop)', () => {
    expect(roleRelevance('Research Intern', 'machine learning and deep learning in PyTorch')).toBe(1.0);
  });

  it('is 0.7 for a single weak JD signal', () => {
    expect(roleRelevance('Program Intern', 'some machine learning exposure helpful')).toBe(0.7);
  });

  it('is 0.35 when nothing on-field appears in title or JD (off-field penalty)', () => {
    expect(roleRelevance('Aerodynamics Intern', 'fluid dynamics, CFD, wind tunnel testing')).toBe(0.35);
    expect(roleRelevance('Accounting Intern', 'GAAP, bookkeeping, reconciliations')).toBe(0.35);
  });

  it('penalizes an OFF-FIELD title even when the JD is full of company-context field words', () => {
    // The real Zipline case: an Aerodynamics role at an autonomous-drone company.
    // The JD says "autonomous", "software", "machine learning" — but that is the
    // COMPANY, not the role. Title-primary: off-field title wins over the JD.
    expect(roleRelevance('Aerodynamics Intern (Fall 2026)',
      'Join Zipline autonomous drones. Collaborate with software, perception, and machine learning teams. Fluid dynamics focus.')).toBe(0.35);
    expect(roleRelevance('Mechanical Engineer Co-op',
      'Work alongside our AI and robotics software teams on autonomous systems.')).toBe(0.35);
    // ...but "Manufacturing SOFTWARE Engineer" stays on-field (on-field check wins first).
    expect(roleRelevance('Manufacturing Software Engineer', '')).toBe(1.0);
  });
});
