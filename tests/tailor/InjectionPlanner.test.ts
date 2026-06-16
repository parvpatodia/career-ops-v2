import { describe, it, expect } from 'vitest';
import { InjectionPlanner } from '../../src/tailor/InjectionPlanner.js';

// Target variant: a real, attested skill (Docker/Kubernetes/AWS) is MISSING here
// but present in the master corpus below. The narrative bullets are the claims
// that must never be altered.
const VARIANT = `## Professional Summary
ML engineer focused on applied research and shipping models to production.

## Experience
**Acme AI — ML Intern**
- Built recommendation models in Python and shipped them to production.
- Wrote data pipelines and evaluation harnesses for offline metrics.

## Skills
- Languages: Python, TypeScript
- ML: PyTorch, scikit-learn`;

// The attestation corpus (master CV): everything Parv genuinely has. Docker,
// Kubernetes, AWS are documented here but absent from the variant above.
const MASTER = `${VARIANT}
- Tools: Docker, Kubernetes, Git, Linux
- Cloud: AWS`;

const EXPERIENCE_BULLETS = [
  '- Built recommendation models in Python and shipped them to production.',
  '- Wrote data pipelines and evaluation harnesses for offline metrics.',
];

describe('InjectionPlanner (no-fabrication)', () => {
  const planner = new InjectionPlanner();

  it('injects an attested-but-missing keyword into the skills section', () => {
    const plan = planner.plan(VARIANT, MASTER, ['Docker']);
    const inj = plan.injections.find((i) => i.keyword === 'Docker');
    expect(inj).toBeTruthy();
    expect(inj!.after.toLowerCase()).toContain('docker');
    // It lands in the skills region, not in an experience bullet.
    expect(EXPERIENCE_BULLETS).not.toContain(inj!.after);

    const out = planner.apply(VARIANT, plan);
    expect(out.toLowerCase()).toContain('docker');
  });

  it('SKIPS a keyword not attested anywhere in the corpus (never fabricates a skill)', () => {
    const plan = planner.plan(VARIANT, MASTER, ['Haskell']);
    expect(plan.injections.find((i) => i.keyword === 'Haskell')).toBeUndefined();
    const skip = plan.skipped.find((s) => s.keyword === 'Haskell');
    expect(skip).toBeTruthy();
    expect(skip!.reason.toLowerCase()).toMatch(/attest|fabricat/);

    const out = planner.apply(VARIANT, plan);
    expect(out.toLowerCase()).not.toContain('haskell');
  });

  it('does not inject a keyword already present in the variant', () => {
    const plan = planner.plan(VARIANT, MASTER, ['Python']);
    expect(plan.injections.find((i) => i.keyword === 'Python')).toBeUndefined();
    const skip = plan.skipped.find((s) => s.keyword === 'Python');
    expect(skip).toBeTruthy();
    expect(skip!.reason.toLowerCase()).toMatch(/already/);
  });

  it('NEVER alters an existing experience claim', () => {
    const plan = planner.plan(VARIANT, MASTER, ['Docker', 'Kubernetes', 'AWS']);
    const out = planner.apply(VARIANT, plan);
    for (const bullet of EXPERIENCE_BULLETS) {
      expect(out).toContain(bullet);
    }
  });

  it('respects the injection budget and surfaces the overflow as skipped', () => {
    const plan = planner.plan(VARIANT, MASTER, ['Docker', 'Kubernetes', 'AWS', 'Git', 'Linux'], 3);
    expect(plan.injections).toHaveLength(3);
    const overflow = plan.skipped.filter((s) => /budget/i.test(s.reason));
    expect(overflow.length).toBeGreaterThanOrEqual(1);
  });

  it('apply() is a faithful no-op when there is nothing to inject', () => {
    const plan = planner.plan(VARIANT, MASTER, ['Python']); // already present
    expect(planner.apply(VARIANT, plan)).toBe(VARIANT);
  });

  it('skips (does not fabricate a section) when the variant has no skills section', () => {
    const noSkills = `## Professional Summary
ML engineer.

## Experience
- Built models in Python.`;
    const plan = planner.plan(noSkills, MASTER, ['Docker']);
    expect(plan.injections).toHaveLength(0);
    const skip = plan.skipped.find((s) => s.keyword === 'Docker');
    expect(skip).toBeTruthy();
    expect(skip!.reason.toLowerCase()).toMatch(/skills section/);
    expect(planner.apply(noSkills, plan)).toBe(noSkills);
  });

  it('is deterministic: identical inputs yield an identical plan', () => {
    const a = planner.plan(VARIANT, MASTER, ['Docker', 'AWS']);
    const b = planner.plan(VARIANT, MASTER, ['Docker', 'AWS']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
