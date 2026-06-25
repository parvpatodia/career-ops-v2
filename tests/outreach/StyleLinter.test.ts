import { describe, it, expect } from 'vitest';
import { StyleLinter } from '../../src/outreach/StyleLinter.js';

const linter = new StyleLinter();

describe('StyleLinter', () => {
  it('passes clean human prose', () => {
    const r = linter.lint('I read your paper on diffusion policy and had a question about the planner.');
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('flags an em dash', () => {
    const r = linter.lint('I loved the paper — the results were strong.');
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === 'dash' && v.label === 'em-dash')).toBe(true);
  });

  it('flags an en dash and the double-hyphen substitute', () => {
    expect(linter.lint('pages 3–5').ok).toBe(false);
    const r = linter.lint('it works -- mostly');
    expect(r.violations.some((v) => v.label === 'double-hyphen')).toBe(true);
  });

  it('catches banned filler and its inflections', () => {
    expect(linter.lint('We could leverage this.').ok).toBe(false);
    expect(linter.lint('leveraging your work').violations[0]!.label).toBe('leverage');
    expect(linter.lint('I utilized the dataset').violations[0]!.label).toBe('utilize');
    expect(linter.lint('a robust pipeline').ok).toBe(false);
    expect(linter.lint('this is crucial').ok).toBe(false);
  });

  it('catches forced enthusiasm and multi-word phrases', () => {
    expect(linter.lint('I am excited to connect').ok).toBe(false);
    expect(linter.lint('Happy to chat anytime').violations[0]!.label).toBe('happy to');
    expect(linter.lint("It's worth noting the gains").ok).toBe(false);
  });

  it('does not false-positive on words that merely contain a banned token', () => {
    // "key" must not match "keyboard"/"keynote"; "robust" guards a stem, not a name.
    const r = linter.lint('I typed on my keyboard before the keynote.');
    expect(r.ok).toBe(true);
  });

  it("enforces Parv's profile never_use list and the classic cold-email tell", () => {
    expect(linter.lint('I believe this is a fit').ok).toBe(false);
    expect(linter.lint('I am writing to ask about a role').ok).toBe(false);
    expect(linter.lint('work that drives impact').ok).toBe(false);
    expect(linter.lint('I hope this email finds you well').violations[0]!.label).toBe('finds you well');
  });

  it('reports every violation, sorted by position', () => {
    const r = linter.lint('This crucial, robust, seamless system.');
    expect(r.violations.map((v) => v.label)).toEqual(['crucial', 'robust', 'seamless']);
  });
});
