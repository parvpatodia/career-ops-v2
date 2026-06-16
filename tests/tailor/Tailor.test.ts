import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Tailor } from '../../src/tailor/Tailor.js';
import type { Job, EvaluationResult } from '../../src/types.js';

// Fixtures, no PII. Variant misses Docker/Kubernetes/Git (master attests them);
// COBOL and SQL are attested nowhere.
const ML = `## Professional Summary
ML engineer focused on applied research and shipping models to production.

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
- Languages: Python, TypeScript
- ML: PyTorch, scikit-learn`;

const MASTER = `${ML}
- Tools: Docker, Kubernetes, Git, Linux`;

const PROFILE = `identity:
  name: "Test User"
  email: "test@example.com"
  phone: "415-000-0000"
  linkedin: "linkedin.com/in/testuser"
  github: "github.com/testuser"
  portfolio: "testuser.dev"
  city: "San Jose"
  state: "CA"
  university: "Test University"
  program: "MS Artificial Intelligence"
  gpa: 3.917
  graduation: "May 2027"`;

const JD = `About the role: Acme AI builds recommendation systems. As an ML Intern you
will work across the model lifecycle, from data pipelines to deployment.

Required Qualifications
- Strong Python and solid SQL fundamentals
- Hands-on experience with Docker and Kubernetes in production
- Exposure to COBOL maintenance for a legacy integration
- Comfortable in a Linux environment with Git workflows

We value applied research and shipping models to production.`;

const JOB: Job = {
  id: 'tailor-001',
  title: 'ML Intern',
  company: 'Acme AI',
  url: 'https://example.com/job',
  platform: 'greenhouse',
  location: 'San Jose, CA',
  remote: false,
  postedAt: '2026-06-10',
  discoveredAt: '2026-06-15',
  jd: JD,
  status: 'evaluated',
};

const EVAL: EvaluationResult = {
  jobId: JOB.id,
  score: 82,
  breakdown: { skillMatch: 80, experienceMatch: 80, locationMatch: 100, visaMatch: 100, companySignal: 70, timingMatch: 90 },
  reasoning: 'fit',
  resumeVariant: 'ml',
  topMatchingSkills: ['Python'],
  missingSkills: [],
  shouldApply: true,
  shouldGenerateCoverLetter: false,
  evaluatedAt: '2026-06-15',
};

let dir: string;
let cvDir: string;
let profilePath: string;
let outputDir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailor-'));
  cvDir = path.join(dir, 'cv');
  outputDir = path.join(dir, 'out');
  fs.mkdirSync(cvDir, { recursive: true });
  fs.writeFileSync(path.join(cvDir, 'ml.md'), ML);
  fs.writeFileSync(path.join(cvDir, 'master.md'), MASTER);
  // A malformed CV with no "## " section headers (its preamble must not leak).
  fs.writeFileSync(path.join(cvDir, 'empty.md'), '# Stray Name\nstray@old.example\n\nFreeform text, no section headers.');
  profilePath = path.join(dir, 'profile.yml');
  fs.writeFileSync(profilePath, PROFILE);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Tailor (verify-or-abstain, browser-free path)', () => {
  it('tailors and verifies a resume, injecting attested keywords and surfacing non-attested ones', () => {
    const tailor = new Tailor({ profilePath, cvDir, outputDir });
    const r = tailor.tailorResume(JOB, 'ml');

    expect(r.verified).toBe(true);
    expect(r.verdict.pass).toBe(true);

    const injected = r.injections.map((i) => i.keyword);
    expect(injected).toContain('Docker'); // attested in master, missing from variant

    const skipped = r.skipped.map((s) => s.keyword);
    expect(skipped).toContain('COBOL'); // attested nowhere -> never fabricated
    expect(skipped).toContain('SQL');

    // Contact comes from profile.yml; injected keyword appears in the HTML.
    expect(r.html).toContain('Test User');
    expect(r.html).toContain('test@example.com');
    expect(r.html.toLowerCase()).toContain('docker');
    expect(fs.existsSync(r.tailoredResumePath)).toBe(true);
  });

  it('ABSTAINS (verified=false) when the resume blows the page budget', () => {
    const tailor = new Tailor({ profilePath, cvDir, outputDir, resumeBudget: { maxVisibleChars: 50 } });
    const r = tailor.tailorResume(JOB, 'ml');
    expect(r.verified).toBe(false);
    expect(r.verdict.checks.find((c) => c.name === 'page-budget' && !c.pass)).toBeTruthy();
  });

  it('ABSTAINS on a header-less CV instead of leaking its raw contact preamble', () => {
    const tailor = new Tailor({ profilePath, cvDir, outputDir });
    const r = tailor.tailorResume(JOB, 'empty' as never);
    expect(r.verified).toBe(false);
    expect(r.verdict.checks.find((c) => c.name === 'section-count' && !c.pass)).toBeTruthy();
    // The candidate name is never duplicated from the body, even on a malformed CV.
    expect(r.html).not.toContain('Stray Name');
  });

  it('never claims a keyword the verifier cannot find (maker/checker agree)', () => {
    const tailor = new Tailor({ profilePath, cvDir, outputDir });
    const r = tailor.tailorResume(JOB, 'ml');
    for (const inj of r.injections) {
      const check = r.verdict.checks.find((c) => c.name === `keyword:${inj.keyword}`);
      expect(check?.pass).toBe(true);
    }
  });
});
