/**
 * M6 end-to-end evidence: tailor a resume + cover letter for a sample JD under
 * verify-or-abstain, in headless Chromium, with NO real PII.
 *
 * Usage: npm run demo:tailor
 *
 *   GREEN   full JD -> extract ATS keywords -> no-fabrication injection (attested
 *           keywords surfaced, non-attested SKIPPED) -> render -> the independent
 *           ResumeVerifier passes -> PDF rendered within the page budget; the
 *           cover letter passes its quality gate and is written.
 *   ABSTAIN the SAME resume verified against a deliberately tiny page budget
 *           FAILS the verifier -> no PDF is shipped, the reason is surfaced.
 *
 * All inputs are fixtures written to a temp dir; only the output PDFs land in
 * output/demo/ (gitignored). config/profile.yml and cv/ are never read.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Tailor } from '../src/tailor/Tailor.js';
import type { Job, EvaluationResult } from '../src/types.js';

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ── Fixtures (no PII) ───────────────────────────────────────────────────────

const ML = `## Professional Summary
ML engineer focused on applied research and shipping models to production.

## Experience
### Acme AI — ML Intern
*Jan 2025 – Present · Remote*
- Built recommendation models in Python and shipped them to production.
- Wrote data pipelines and evaluation harnesses for offline metrics.

## Projects
### Eval Harness
- Authored an open-source evaluation harness used across the team.

## Education
### MS Artificial Intelligence, Demo University
*2025 – 2027*

## Skills
- Languages: Python, TypeScript
- ML: PyTorch, scikit-learn`;

const MASTER = `${ML}
- Tools: Docker, Kubernetes, Git, Linux`;

const PROFILE = `identity:
  name: "Demo Candidate"
  email: "demo@example.com"
  phone: "408-555-0100"
  linkedin: "linkedin.com/in/democandidate"
  github: "github.com/democandidate"
  portfolio: "democandidate.dev"
  city: "San Jose"
  state: "CA"
  university: "Demo University"
  program: "MS Artificial Intelligence"
  gpa: 3.917
  graduation: "May 2027"`;

const COVER_TEMPLATE = `{{DATE}}

Dear {{COMPANY_NAME}} team,

I am applying for the {{ROLE_TITLE}} position. {{PARA_1_WHY_COMPANY}}

{{PARA_2_STRONGEST_PROJECT}}

{{PARA_3_EXPERIENCE_ALIGNMENT}}

{{PARA_4_CLOSE}}

Sincerely,
Demo Candidate

## Rules for this template
- This block is stripped before the letter is verified.`;

const JD = `About the role: Globex builds large-scale recommendation systems. As a Machine
Learning Intern you will work across the full model lifecycle, from data
pipelines to deployment, with an applied research team.

Required Qualifications
- Strong programming in Python and solid SQL fundamentals
- Hands-on experience shipping services with Docker and Kubernetes
- Exposure to COBOL is helpful for one legacy data integration
- Comfortable in a Linux environment with Git-based workflows

We value engineers who ship models to production and measure their impact.`;

const JOB: Job = {
  id: 'demo-tailor-001',
  title: 'Machine Learning Intern',
  company: 'Globex',
  url: 'https://example.com/job',
  platform: 'greenhouse',
  location: 'San Jose, CA',
  remote: false,
  postedAt: '2026-06-12',
  discoveredAt: '2026-06-15',
  jd: JD,
  status: 'evaluated',
};

const EVAL: EvaluationResult = {
  jobId: JOB.id,
  score: 84,
  breakdown: { skillMatch: 85, experienceMatch: 80, locationMatch: 100, visaMatch: 100, companySignal: 75, timingMatch: 90 },
  reasoning: 'strong fit',
  resumeVariant: 'ml',
  topMatchingSkills: ['Python', 'PyTorch'],
  missingSkills: [],
  shouldApply: true,
  shouldGenerateCoverLetter: true,
  evaluatedAt: '2026-06-15',
};

const COVER_DATA = {
  company: 'Globex',
  role: 'Machine Learning Intern',
  companySpecificAngle: 'Your recommendation platform is the kind of applied ML I want to build.',
  strongestProject: 'I built a retrieval system that improved ranking quality on a held-out set.',
  experienceAlignment: 'At Demo University I shipped models end to end, from data pipelines to deployment.',
  closing: 'I would value the chance to contribute to your team.',
};

function writeFixtures(): { cvDir: string; profilePath: string; coverTemplatePath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-tailor-'));
  const cvDir = path.join(dir, 'cv');
  fs.mkdirSync(cvDir, { recursive: true });
  fs.writeFileSync(path.join(cvDir, 'ml.md'), ML);
  fs.writeFileSync(path.join(cvDir, 'master.md'), MASTER);
  const profilePath = path.join(dir, 'profile.yml');
  fs.writeFileSync(profilePath, PROFILE);
  const coverTemplatePath = path.join(dir, 'cover_letter_template.md');
  fs.writeFileSync(coverTemplatePath, COVER_TEMPLATE);
  return { cvDir, profilePath, coverTemplatePath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function main(): Promise<void> {
  console.log(C.bold('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(C.bold('║   career-ops M6 — Tailor: verify-or-abstain resume + cover ║'));
  console.log(C.bold('╚══════════════════════════════════════════════════════════╝'));
  console.log(C.dim('  Fixtures only, no PII. PDFs render to output/demo/.'));

  const fx = writeFixtures();
  fs.mkdirSync('output/demo', { recursive: true });
  let greenOk = false;
  let abstainOk = false;

  try {
    // ── GREEN: full tailor, expect verified + PDF + cover letter ─────────────
    console.log(`\n${'═'.repeat(60)}`);
    console.log(C.bold(C.cyan(`  ${JOB.company} — ${JOB.title}  (resume variant: ${EVAL.resumeVariant})`)));
    console.log('═'.repeat(60));

    const tailor = new Tailor({
      profilePath: fx.profilePath,
      cvDir: fx.cvDir,
      outputDir: 'output/demo',
      coverTemplatePath: fx.coverTemplatePath,
      coverOutputDir: 'output/demo',
    });

    const r = await tailor.tailor(JOB, EVAL, COVER_DATA);

    console.log(`  injected (attested): ${C.green(r.injectedKeywords.map((i) => i.keyword).join(', ') || '(none)')}`);
    console.log(`  skipped  (no home) : ${C.yellow((r.skippedKeywords ?? []).join(', ') || '(none)')}`);
    for (const inj of r.injectedKeywords) {
      console.log(`    ${C.green('+')} ${inj.keyword.padEnd(14)} ${C.dim(inj.location + ' — ' + inj.reason)}`);
    }
    console.log(`  resume verified    : ${r.verified ? C.green('PASS ✓') : C.red('FAIL ✗')}`);
    console.log(`  resume PDF         : ${r.pdfPath ? C.green(r.pdfPath) : C.red('(abstained)')}`);
    console.log(`  cover letter       : ${r.coverLetterPath ? C.green(r.coverLetterPath) : C.red('(abstained/skipped)')}`);

    const pdfOk = !!r.pdfPath && fs.existsSync(r.pdfPath) && fs.statSync(r.pdfPath).size > 0;
    greenOk = r.verified && pdfOk && !!r.coverLetterPath;

    // ── ABSTAIN: same resume, tiny page budget -> verifier must fail ─────────
    console.log(`\n${'─'.repeat(60)}`);
    console.log(C.bold('  ABSTAIN check — same resume, deliberately tiny page budget'));
    const strict = new Tailor({
      profilePath: fx.profilePath,
      cvDir: fx.cvDir,
      outputDir: 'output/demo',
      resumeBudget: { maxVisibleChars: 50 },
    });
    const ra = strict.tailorResume(JOB, 'ml');
    const failed = ra.verdict.checks.filter((c) => !c.pass).map((c) => c.name);
    console.log(`  resume verified    : ${ra.verified ? C.red('PASS (unexpected) ✗') : C.green('ABSTAINED ✓')}`);
    console.log(`  failing checks     : ${C.yellow(failed.join(', '))}`);
    abstainOk = !ra.verified && failed.includes('page-budget');
  } finally {
    fx.cleanup();
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(C.bold('  SCORECARD'));
  console.log(`  ${greenOk ? C.green('PASS ✓') : C.red('FAIL ✗')}  GREEN   — tailor → verify → PDF + cover letter`);
  console.log(`  ${abstainOk ? C.green('PASS ✓') : C.red('FAIL ✗')}  ABSTAIN — verifier rejects an out-of-budget resume\n`);

  process.exit(greenOk && abstainOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
