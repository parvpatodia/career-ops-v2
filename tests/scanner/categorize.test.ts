/**
 * categorize buckets a role for the command-center UI grouping (M8 F4).
 * Order matters (first match wins): an ML-flavored SWE role is AI/ML, and a
 * perception/AV role is Robotics/AV even though it also contains ML language.
 */
import { describe, it, expect } from 'vitest';
import { categorize } from '../../src/scanner/categorize.js';

describe('categorize', () => {
  it('tags robotics/AV before AI/ML when both signals are present', () => {
    expect(categorize('Perception Engineer Intern, Autonomous Vehicles')).toBe('Robotics/AV');
    expect(categorize('Robotics Software Engineer Intern')).toBe('Robotics/AV');
  });

  it('tags AI/ML roles', () => {
    expect(categorize('Machine Learning Engineer Intern')).toBe('AI/ML');
    expect(categorize('Applied Scientist Intern, LLM')).toBe('AI/ML');
    expect(categorize('Computer Vision Research Intern')).toBe('AI/ML');
  });

  it('tags data and generic software', () => {
    expect(categorize('Data Engineer Intern')).toBe('Data');
    expect(categorize('Software Engineer Intern, Backend')).toBe('Software');
    expect(categorize('Full-Stack Developer Co-op')).toBe('Software');
  });

  it('falls back to Other for an unrecognized title', () => {
    expect(categorize('Product Design Intern')).toBe('Other');
  });

  it('uses the JD as a fallback signal when the title is vague', () => {
    expect(categorize('Engineering Intern', 'work on our machine learning ranking models')).toBe('AI/ML');
  });
});
