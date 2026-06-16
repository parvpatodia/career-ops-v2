import { describe, it, expect } from 'vitest';
import { ResumeRenderer } from '../../src/tailor/ResumeRenderer.js';
import { ResumeVerifier, type ContactFacts } from '../../src/tailor/ResumeVerifier.js';

const IDENTITY: ContactFacts = {
  name: 'Test User',
  email: 'test@example.com',
  phone: '415-000-0000',
  linkedin: 'https://linkedin.com/in/testuser',
  github: 'https://github.com/testuser',
  portfolio: 'https://testuser.dev',
  location: 'San Francisco, CA',
};

// Note the preamble before the first "## " — a name + contact line that MUST be
// dropped so profile.yml stays the single source of contact truth.
const MARKDOWN = `# Parv Placeholder
old@contact.example | 555-old-phone

## Professional Summary
ML engineer shipping models to production.

## Experience
### Acme AI — ML Intern
*Jan 2025 – Present · Remote*
- Built recommendation models in Python and shipped them to production.

## Projects
### Eval Harness
- Authored an open-source evaluation harness.

## Education
### MS Artificial Intelligence, Test University
*2025 – 2027*

## Skills
- Languages: Python, TypeScript, Docker`;

const SECTIONS = ['Professional Summary', 'Experience', 'Projects', 'Education', 'Skills'];

describe('ResumeRenderer', () => {
  const renderer = new ResumeRenderer();

  it('fills every placeholder (none leak)', () => {
    const html = renderer.renderHtml(MARKDOWN, IDENTITY);
    expect(html).not.toMatch(/\{\{\s*[\w.]+\s*\}\}/);
  });

  it('uses profile.yml contact facts in the header, not the markdown preamble', () => {
    const html = renderer.renderHtml(MARKDOWN, IDENTITY);
    expect(html).toContain('Test User');
    expect(html).toContain('test@example.com');
    expect(html).toContain('415-000-0000');
    // The markdown preamble identity must be dropped entirely.
    expect(html).not.toContain('Parv Placeholder');
    expect(html).not.toContain('old@contact.example');
    expect(html).not.toContain('555-old-phone');
  });

  it('renders every markdown section into the body', () => {
    const html = renderer.renderHtml(MARKDOWN, IDENTITY);
    for (const s of SECTIONS) expect(html).toContain(s);
  });

  it('omits the portfolio link entirely when portfolio is null', () => {
    const html = renderer.renderHtml(MARKDOWN, { ...IDENTITY, portfolio: null });
    expect(html).not.toContain('testuser.dev');
    expect(html).not.toMatch(/\{\{\s*[\w.]+\s*\}\}/); // still no leak
  });

  it('escapes HTML-significant characters in body text', () => {
    const md = '## Summary\nWorked on A & B with <C> pipelines.';
    const html = renderer.renderHtml(md, IDENTITY);
    expect(html).toContain('A &amp; B');
    expect(html).toContain('&lt;C&gt;');
  });

  it('sectionTitles lists the body section headings (preamble ignored)', () => {
    expect(ResumeRenderer.sectionTitles(MARKDOWN)).toEqual(SECTIONS);
  });

  it('produces output that the ResumeVerifier passes (maker output satisfies the checker)', () => {
    const html = renderer.renderHtml(MARKDOWN, IDENTITY);
    const verdict = new ResumeVerifier().verify({
      renderedHtml: html,
      identity: IDENTITY,
      requiredSections: ResumeRenderer.sectionTitles(MARKDOWN),
      claimedKeywords: ['Docker'],
    });
    expect(verdict.pass).toBe(true);
  });
});
