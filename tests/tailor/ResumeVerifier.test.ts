import { describe, it, expect } from 'vitest';
import { ResumeVerifier } from '../../src/tailor/ResumeVerifier.js';
import type { ContactFacts } from '../../src/tailor/ResumeVerifier.js';

// Fake test identity — never real PII.
const IDENTITY: ContactFacts = {
  name: 'Test User',
  email: 'test@example.com',
  phone: '415-000-0000',
  linkedin: 'https://linkedin.com/in/testuser',
  github: 'https://github.com/testuser',
  portfolio: 'https://testuser.dev',
  location: 'San Francisco, CA',
};

const REQUIRED_SECTIONS = ['Professional Summary', 'Experience', 'Projects', 'Education', 'Skills'];
const CLAIMED_KEYWORDS = ['Docker', 'Kubernetes'];

const CLEAN_HTML = `<!DOCTYPE html><html><body>
<h1>Test User</h1>
<div class="contact-row">
  <span>415-000-0000</span> | <span>test@example.com</span> |
  <a href="https://linkedin.com/in/testuser">linkedin.com/in/testuser</a> |
  <a href="https://github.com/testuser">github.com/testuser</a> |
  <a href="https://testuser.dev">testuser.dev</a> | <span>San Francisco, CA</span>
</div>
<h2>Professional Summary</h2><p>ML engineer shipping models to production.</p>
<h2>Experience</h2><ul><li>Built recommendation models in Python.</li></ul>
<h2>Projects</h2><ul><li>Open-source eval harness.</li></ul>
<h2>Education</h2><p>MS, Test University.</p>
<h2>Skills</h2><ul><li>Languages: Python, TypeScript, Docker, Kubernetes</li></ul>
</body></html>`;

function input(html: string, over?: Partial<Parameters<ResumeVerifier['verify']>[0]>) {
  return {
    renderedHtml: html,
    identity: IDENTITY,
    requiredSections: REQUIRED_SECTIONS,
    claimedKeywords: CLAIMED_KEYWORDS,
    ...over,
  };
}

describe('ResumeVerifier (maker/checker)', () => {
  const verifier = new ResumeVerifier();

  it('passes a clean, complete rendered resume', () => {
    const v = verifier.verify(input(CLEAN_HTML));
    expect(v.pass).toBe(true);
    expect(v.checks.every((c) => c.pass)).toBe(true);
  });

  it('FAILS when a required section is dropped', () => {
    const sabotaged = CLEAN_HTML.replace('<h2>Experience</h2><ul><li>Built recommendation models in Python.</li></ul>', '');
    const v = verifier.verify(input(sabotaged));
    expect(v.pass).toBe(false);
    expect(v.checks.find((c) => /experience/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('FAILS when contact info does not match profile (email mangled)', () => {
    const sabotaged = CLEAN_HTML.replace('test@example.com', 'wrong@evil.com');
    const v = verifier.verify(input(sabotaged));
    expect(v.pass).toBe(false);
    expect(v.checks.find((c) => /email/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('FAILS when a claimed keyword is absent from the output', () => {
    const sabotaged = CLEAN_HTML.replace('Docker, Kubernetes', 'TypeScript'); // Docker/Kubernetes gone
    const v = verifier.verify(input(sabotaged));
    expect(v.pass).toBe(false);
    expect(v.checks.find((c) => /docker/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('FAILS when a template placeholder leaked into the output', () => {
    const sabotaged = CLEAN_HTML.replace('test@example.com', '{{EMAIL}}');
    const v = verifier.verify(input(sabotaged));
    expect(v.pass).toBe(false);
    // both the placeholder check AND the email-match check should fire
    expect(v.checks.find((c) => /placeholder/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('FAILS when the resume exceeds the page budget', () => {
    const v = verifier.verify(input(CLEAN_HTML, { budget: { maxVisibleChars: 50 } }));
    expect(v.pass).toBe(false);
    expect(v.checks.find((c) => /budget|page|length/i.test(c.name) && !c.pass)).toBeTruthy();
  });

  it('does not require a null portfolio to appear', () => {
    const noPortfolio = { ...IDENTITY, portfolio: null };
    const html = CLEAN_HTML
      .replace('<a href="https://testuser.dev">testuser.dev</a> |', '');
    const v = verifier.verify(input(html, { identity: noPortfolio }));
    expect(v.pass).toBe(true);
  });

  it('reports every failing check, not just the first', () => {
    let sabotaged = CLEAN_HTML.replace('test@example.com', 'wrong@evil.com');
    sabotaged = sabotaged.replace('<h2>Skills</h2><ul><li>Languages: Python, TypeScript, Docker, Kubernetes</li></ul>', '');
    const v = verifier.verify(input(sabotaged));
    const failed = v.checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed.some((n) => /email/i.test(n))).toBe(true);
    expect(failed.some((n) => /skills/i.test(n))).toBe(true);
  });
});
