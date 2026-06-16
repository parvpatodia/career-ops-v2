/**
 * M7 end-to-end evidence: ALL subsystems in ONE cohesive flow, driven by the
 * Orchestrator, joined by one event log. No real PII, no network.
 *
 * Usage: npm run demo:integration
 *
 *   SOURCING  a sourced Greenhouse job clears the FreshnessFilter (<=14d) and
 *             the TermFilter (Summer/Fall 2026) gates.
 *   TAILOR    the real M6 Tailor extracts ATS keywords, injects only attested
 *             ones, renders + VERIFIES the resume, and writes a real PDF in
 *             headless Chromium; the Orchestrator queues a Ready application
 *             carrying that PDF. A non-verified resume would queue NOTHING.
 *   APPLY     pass 1 (no approval): the SAME pipeline fills the Greenhouse form,
 *             abstains on the one unknown question, fires a (printed)
 *             notification, and logs it. The answer is supplied (the human
 *             touchpoint) and learned. Pass 2 (approved): every field is filled,
 *             INDEPENDENTLY read back + verified, then submitted (fixture button),
 *             with a receipt + ATS confirmation.
 *
 * The whole run uses ONE ApplicationStore: the tailor's queue add and every
 * apply event land in one event log, all joined by appIdFor(company, role). The
 * generated view ends at status Applied. Everything is a fixture written to a
 * temp dir; only the resume PDF lands in output/demo/ (gitignored).
 */

import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Tailor } from '../src/tailor/Tailor.js';
import { Orchestrator } from '../src/orchestrator/Orchestrator.js';
import { FixtureApplySessionFactory } from '../src/orchestrator/PlaywrightApplySessionFactory.js';
import { ApplicationStore } from '../src/tracker/ApplicationStore.js';
import { AnswerInbox } from '../src/applier/AnswerInbox.js';
import { AnswerKB, CompositeAnswerSource } from '../src/applier/AnswerKB.js';
import { Notifier } from '../src/applier/Notifier.js';
import type { Notification } from '../src/applier/Notifier.js';
import type { AnswerSource } from '../src/applier/IntentPayload.js';
import type { Answer } from '../src/applier/AnswerGenerator.js';
import { FreshnessFilter } from '../src/pipeline/FreshnessFilter.js';
import { TermFilter } from '../src/pipeline/TermFilter.js';
import { appIdFor } from '../src/store/events.js';
import type { BatchApproval } from '../src/applier/Autopilot.js';
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
- Comfortable in a Linux environment with Git-based workflows

We value engineers who ship models to production and measure their impact.`;

const JOB: Job = {
  id: 'gh-demo-001',
  title: 'Machine Learning Engineer Intern',
  company: 'Globex',
  url: 'https://boards.greenhouse.io/globex/jobs/8675309',
  applyUrl: 'https://boards.greenhouse.io/globex/jobs/8675309',
  platform: 'greenhouse',
  location: 'San Jose, CA',
  remote: false,
  postedAt: '2026-06-12', // 4 days before "today" (2026-06-16): fresh
  discoveredAt: '2026-06-15',
  jd: JD,
  status: 'evaluated',
};

// Fixture evaluation (the Evaluator has its own tests + needs profile.yml; this
// demo proves the integration seam, not scoring).
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
  role: 'Machine Learning Engineer Intern',
  companySpecificAngle: 'Your recommendation platform is the kind of applied ML I want to build.',
  strongestProject: 'I built a retrieval system that improved ranking quality on a held-out set.',
  experienceAlignment: 'At Demo University I shipped models end to end, from data pipelines to deployment.',
  closing: 'I would value the chance to contribute to your team.',
};

// Identity stub (the form's name/email/phone fields). AnswerKB covers the
// screening questions; the GPU-kernel question is intentionally unknown.
const IDENTITY: Record<string, string> = {
  'first name': 'Ada',
  'last name': 'Lovelace',
  'email': 'ada@example.com',
  'phone': '+1-555-0100',
};
const stubIdentity: AnswerSource = {
  generate(question: string): Answer | null {
    const q = question.toLowerCase().trim();
    for (const [k, v] of Object.entries(IDENTITY)) {
      if (q.includes(k)) return { value: v, confidence: 'high', needsReview: false };
    }
    return null;
  },
};

const GPU_LABEL = 'What is the most interesting GPU kernel you have written?';
const GPU_ANSWER = 'A fused FlashAttention kernel in Triton, 2.3x over the naive PyTorch baseline.';
const ANSWERS_FILE = path.resolve('tests/demo/fixtures/answers.demo.yml');
const GH_JOB = JSON.parse(fs.readFileSync(path.resolve('tests/demo/fixtures/greenhouse-job.json'), 'utf8'));
const GH_FORM = `file://${path.resolve('tests/demo/fixtures/greenhouse-form.html')}`;

const APPROVAL: BatchApproval = { approvedBy: 'parv', approvedAt: new Date().toISOString(), note: 'demo batch' };

function writeTailorFixtures(): { cvDir: string; profilePath: string; coverTemplatePath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-int-cv-'));
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
  console.log(C.bold('\n╔══════════════════════════════════════════════════════════════╗'));
  console.log(C.bold('║  career-ops M7 — Integration: source → tailor → queue → apply  ║'));
  console.log(C.bold('╚══════════════════════════════════════════════════════════════╝'));
  console.log(C.dim('  One Orchestrator, one event log, fixtures only, no PII, no network.'));

  const fx = writeTailorFixtures();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-int-state-'));
  fs.mkdirSync('output/demo', { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const sent: Notification[] = [];
  const notifier = new Notifier((n) => {
    sent.push(n);
    console.log(`    ${C.yellow('🔔 notify')} [${n.kind}] ${C.dim(n.message)}`);
  });

  const store = new ApplicationStore(path.join(stateDir, 'applications.json'), path.join(stateDir, 'applications.md'));
  const inbox = new AnswerInbox(path.join(stateDir, 'pending.json'), path.join(stateDir, 'learned.yml'));
  const tailor = new Tailor({
    profilePath: fx.profilePath,
    cvDir: fx.cvDir,
    outputDir: 'output/demo',
    coverTemplatePath: fx.coverTemplatePath,
    coverOutputDir: 'output/demo',
  });
  const answers = (): AnswerSource =>
    new CompositeAnswerSource([new AnswerKB(ANSWERS_FILE), inbox.learnedSource(), stubIdentity]);
  const sessions = new FixtureApplySessionFactory(browser, { kind: 'greenhouse', fileUrl: GH_FORM, greenhouseJob: GH_JOB });

  const orch = new Orchestrator({
    tailor,
    apps: store,
    notifier,
    inbox,
    answers,
    sessions,
    receiptsDir: path.join(stateDir, 'receipts'),
  });

  const appId = appIdFor(JOB.company, JOB.title);
  let sourcingOk = false;
  let queuedOk = false;
  let needsInputOk = false;
  let submittedOk = false;
  let oneLogOk = false;

  try {
    // ── SOURCING gates ───────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(64)}`);
    console.log(C.bold(C.cyan(`  ${JOB.company} — ${JOB.title}`)));
    console.log('═'.repeat(64));
    const { fresh } = new FreshnessFilter().filter([JOB]);
    const { matched } = new TermFilter().filter(fresh);
    sourcingOk = matched.length === 1;
    console.log(`  sourcing gates     : ${sourcingOk ? C.green('PASS ✓') : C.red('FAIL ✗')}  ${C.dim('fresh (<=14d) + on-term (Summer/Fall 2026)')}`);

    // ── STAGE 1: tailor + queue ───────────────────────────────────────────────
    const t = await orch.tailorAndQueue(JOB, EVAL, COVER_DATA);
    queuedOk = t.phase === 'queued';
    console.log(`\n  ${C.bold('TAILOR → QUEUE')}    : ${queuedOk ? C.green(t.phase.toUpperCase()) : C.red(t.phase.toUpperCase())}`);
    if (t.phase === 'queued') {
      console.log(`    resume PDF       : ${C.green(t.application.pdfPath ?? '(none)')}`);
      console.log(`    cover letter     : ${t.application.coverLetterPath ? C.green(t.application.coverLetterPath) : C.dim('(skipped)')}`);
      console.log(`    queue status     : ${C.green(t.application.status)}  ${C.dim('(variant: ' + t.application.resumeVariant + ')')}`);
      console.log(`    event log        : ${C.dim(store.eventStore().readAll().events.map((e) => e.type).join(' → '))}`);
    }

    if (t.phase === 'queued') {
      // ── STAGE 2: apply pass 1 (no approval) — abstain on the unknown ──────────
      console.log(`\n  ${C.bold('APPLY pass 1')}      ${C.dim('(autonomous, no approval)')}`);
      const a1 = await orch.apply(t.application);
      needsInputOk = a1.phase === 'needs_input';
      console.log(`    phase            : ${needsInputOk ? C.green(a1.phase.toUpperCase()) : C.red(a1.phase.toUpperCase())}`);
      if (a1.phase === 'needs_input') {
        for (const p of a1.pending) console.log(`    ${C.yellow('⚑ unknown')} "${p.label}" ${C.dim('(no field filled)')}`);
        inbox.resolve(GPU_LABEL, GPU_ANSWER);
        console.log(`    ${C.green('✓ answered')} → learned (never unknown again)`);
      }

      // ── STAGE 3: apply pass 2 (approved) — verify + submit ────────────────────
      console.log(`\n  ${C.bold('APPLY pass 2')}      ${C.dim('(approved batch)')}`);
      const a2 = await orch.apply(t.application, { approval: APPROVAL });
      submittedOk = a2.phase === 'submitted';
      console.log(`    phase            : ${submittedOk ? C.green(a2.phase.toUpperCase()) : C.red(a2.phase.toUpperCase())}`);
      if (a2.phase === 'submitted') {
        for (const c of a2.verdict.checks) {
          const got = c.actual === null ? '<unread>' : c.actual;
          console.log(`    ${C.green('✓')} ${c.label.slice(0, 44).padEnd(44)} : ${C.green(String(got).slice(0, 36))}`);
        }
        console.log(`    ${C.green('SUBMITTED')} (fixture) — receipt ${a2.receipt.correlationId}, ${a2.receipt.atsConfirmation ?? '(no confirmation)'}`);
      }
    }

    // ── ONE LOG, joined by appId ──────────────────────────────────────────────
    const events = store.eventStore().readAll().events;
    const types = events.map((e) => e.type);
    const allOneApp = events.length > 0 && events.every((e) => e.appId === appId);
    oneLogOk = allOneApp &&
      types.join(',') === ['queued', 'abstained', 'fill_verified', 'submitted', 'confirmed'].join(',');
    console.log(`\n  ${C.bold('ONE EVENT LOG')}     : ${C.dim(types.join(' → '))}`);
    console.log(`    all one appId    : ${allOneApp ? C.green('YES ' + appId) : C.red('NO')}`);
    console.log(`    final status     : ${store.findByCompanyAndRole(JOB.company, JOB.title)?.status === 'Applied' ? C.green('Applied') : C.red(store.findByCompanyAndRole(JOB.company, JOB.title)?.status ?? '(none)')}`);

    await fs.promises.mkdir('output/demo', { recursive: true });
  } finally {
    await browser.close();
    fx.cleanup();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  const pass = sourcingOk && queuedOk && needsInputOk && submittedOk && oneLogOk;
  console.log(`\n${'═'.repeat(64)}`);
  console.log(C.bold('  SCORECARD'));
  console.log(`  ${sourcingOk ? C.green('PASS ✓') : C.red('FAIL ✗')}  SOURCING — fresh + on-term gates`);
  console.log(`  ${queuedOk ? C.green('PASS ✓') : C.red('FAIL ✗')}  TAILOR   — verify-or-abstain → Ready app with a real PDF`);
  console.log(`  ${needsInputOk ? C.green('PASS ✓') : C.red('FAIL ✗')}  APPLY 1  — abstain on the unknown, notify, log (human touchpoint)`);
  console.log(`  ${submittedOk ? C.green('PASS ✓') : C.red('FAIL ✗')}  APPLY 2  — resume → verify → gated submit + receipt`);
  console.log(`  ${oneLogOk ? C.green('PASS ✓') : C.red('FAIL ✗')}  ONE LOG  — tailor + apply events, one log, joined by appId\n`);

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
