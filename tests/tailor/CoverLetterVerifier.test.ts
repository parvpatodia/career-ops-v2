import { describe, it, expect } from 'vitest';
import { CoverLetterVerifier } from '../../src/tailor/CoverLetterVerifier.js';

const CLEAN = `June 16, 2026

Dear Acme Robotics team,

Your work on warehouse autonomy is why I am applying for the Robotics Software
Intern role. At Northeastern University I built a diffusion-policy pipeline that
cut planning latency, and I want to bring that to your fleet.

I have shipped reinforcement learning systems end to end and would welcome the
chance to do the same with your team.

Sincerely,
Test Candidate`;

function input(letter: string, over?: Partial<Parameters<CoverLetterVerifier['verify']>[0]>) {
  return {
    letter,
    company: 'Acme Robotics',
    role: 'Robotics Software Intern',
    groundingFacts: ['Northeastern University'],
    ...over,
  };
}

describe('CoverLetterVerifier', () => {
  const v = new CoverLetterVerifier();

  it('passes a clean, specific, grounded letter', () => {
    const verdict = v.verify(input(CLEAN));
    expect(verdict.pass).toBe(true);
  });

  it('FAILS on a forbidden AI-filler phrase', () => {
    const bad = CLEAN.replace('Your work on warehouse autonomy', 'I am passionate about your innovative solutions');
    const verdict = v.verify(input(bad));
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => /forbidden/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('FAILS on an em dash', () => {
    const bad = CLEAN.replace('end to end', 'end — to — end');
    const verdict = v.verify(input(bad));
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => /dash/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('does NOT false-positive on a forbidden word embedded in a larger word', () => {
    // "key" must not match "monkey"; whole-word matching only.
    const ok = CLEAN.replace('your fleet.', 'monkey-bar testbeds and donkey logistics.');
    const verdict = v.verify(input(ok));
    expect(verdict.checks.find((c) => /forbidden/i.test(c.name))?.pass).toBe(true);
  });

  it('FAILS when the company is not named', () => {
    const verdict = v.verify(input(CLEAN, { company: 'Globex Corp' }));
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => /company/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('FAILS when the role is not named', () => {
    const verdict = v.verify(input(CLEAN, { role: 'Quantum Chef' }));
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => /role/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('FAILS when a template placeholder leaked', () => {
    const bad = CLEAN.replace('Acme Robotics team', '{{COMPANY_NAME}} team');
    const verdict = v.verify(input(bad));
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => /placeholder/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('FAILS when not grounded in any supplied real profile fact', () => {
    const verdict = v.verify(input(CLEAN, { groundingFacts: ['Stanford University'] }));
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.find((c) => /ground/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('skips the grounding check when no grounding facts are supplied', () => {
    const verdict = v.verify(input(CLEAN, { groundingFacts: [] }));
    expect(verdict.pass).toBe(true);
  });
});
