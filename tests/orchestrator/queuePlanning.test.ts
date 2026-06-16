/**
 * SPEC M7: the F-1 eligibility gate + Application -> Job reconstruction the `run`
 * CLI relies on. Pure, so the safety-critical logic is tested directly.
 */

import { describe, it, expect } from 'vitest';
import { isIneligible, jobFromApp, parseNotes } from '../../src/orchestrator/queuePlanning.js';
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
