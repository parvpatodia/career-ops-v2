/**
 * SPEC M5: target-term gate. Excludes only postings that PROVABLY state a
 * non-target term; keeps target-term and unstated-term roles. Mirrors
 * verify-or-abstain: do not exclude on a guess.
 */

import { describe, it, expect } from 'vitest';
import { TermFilter } from '../../src/pipeline/TermFilter.js';
import type { Job } from '../../src/types.js';

function job(title: string, jd = ''): Job {
  return {
    id: 'x',
    title,
    company: 'Co',
    url: 'u',
    platform: 'greenhouse',
    location: '',
    remote: false,
    postedAt: '2026-06-10',
    discoveredAt: '2026-06-10',
    jd,
    status: 'discovered',
  };
}

function titlesOf(jobs: Job[]): string[] {
  return jobs.map((j) => j.title);
}

describe('TermFilter (default Summer/Fall 2026)', () => {
  const tf = new TermFilter();

  it('keeps target-term roles', () => {
    const r = tf.filter([job('Fall 2026 SWE Intern'), job('Summer 2026 ML Internship')]);
    expect(r.offTerm).toHaveLength(0);
    expect(titlesOf(r.matched)).toHaveLength(2);
  });

  it('keeps roles that state no term at all (most postings)', () => {
    const r = tf.filter([job('Software Engineer Intern'), job('Robotics Co-op')]);
    expect(titlesOf(r.matched)).toEqual(['Software Engineer Intern', 'Robotics Co-op']);
    expect(r.offTerm).toHaveLength(0);
  });

  it('excludes a past-year term', () => {
    const r = tf.filter([job('Summer 2025 Software Engineering Intern')]);
    expect(titlesOf(r.offTerm)).toEqual(['Summer 2025 Software Engineering Intern']);
    expect(r.matched).toHaveLength(0);
  });

  it('excludes a non-target season in the target year', () => {
    const r = tf.filter([job('Spring 2026 Co-op'), job('Winter 2026 Intern')]);
    expect(r.offTerm).toHaveLength(2);
    expect(r.matched).toHaveLength(0);
  });

  it('excludes a bare past year in the title', () => {
    const r = tf.filter([job('2025 Summer Analyst Internship')]);
    expect(r.offTerm).toHaveLength(1);
  });

  it('keeps a target bare year with no season', () => {
    const r = tf.filter([job('2026 University Recruiting — SWE Intern')]);
    expect(titlesOf(r.matched)).toHaveLength(1);
    expect(r.offTerm).toHaveLength(0);
  });

  it('reads a season+year term from the JD', () => {
    const r = tf.filter([job('Machine Learning Intern', 'Join our Summer 2025 cohort in San Jose.')]);
    expect(r.offTerm).toHaveLength(1);
  });

  it('ignores stray (non-term) years in the JD body', () => {
    const r = tf.filter([job('ML Intern', 'Founded in 2019. By 2027 we aim to scale to 100 GPUs.')]);
    expect(titlesOf(r.matched)).toEqual(['ML Intern']);
    expect(r.offTerm).toHaveLength(0);
  });

  it('keeps a multi-term posting when any stated term is on target', () => {
    const r = tf.filter([job('Summer/Fall 2026 Engineering Intern')]);
    expect(titlesOf(r.matched)).toHaveLength(1);
    expect(r.offTerm).toHaveLength(0);
  });

  it('is configurable: targeting Fall 2027 makes Fall 2026 off-term', () => {
    const tf2027 = new TermFilter({ seasons: ['fall'], years: [2027] });
    const r = tf2027.filter([job('Fall 2026 Intern'), job('Fall 2027 Intern')]);
    expect(titlesOf(r.matched)).toEqual(['Fall 2027 Intern']);
    expect(titlesOf(r.offTerm)).toEqual(['Fall 2026 Intern']);
  });
});
