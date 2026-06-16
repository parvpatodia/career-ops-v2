/**
 * M4 end-to-end evidence: the SAME autopilot loop driving TWO portals
 * (Workday and Greenhouse) against realistic fixtures, in headless Chromium.
 *
 * Usage: npm run demo:autopilot
 *
 * For each portal, with no human input except the one designed touchpoint:
 *   PASS 1  fill+verify; the unknown free-text question ABSTAINS before
 *           touching the form; a REAL macOS notification fires; the question is
 *           logged to the AnswerInbox.
 *   resume  the answer is supplied (AnswerInbox.resolve) -> learned forever.
 *   PASS 2  re-run with the answer + an explicit batch approval: every field is
 *           auto-filled, INDEPENDENTLY read back and verified green, then
 *           submitted (fixture button only), with a receipt + confirmation.
 *
 * Only the FormSource differs between portals; ApplicationAdapter, Autopilot,
 * Verifier, AnswerInbox, Notifier, SubmissionRecorder are shared. Safe: submit
 * clicks a fixture button (no network); no profile.yml; no real PII.
 */

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { WorkdayDriver } from '../src/applier/WorkdayDriver.js';
import { WorkdayAdapter } from '../src/applier/WorkdayAdapter.js';
import { ApplicationAdapter } from '../src/applier/ApplicationAdapter.js';
import { GreenhouseFormSource } from '../src/applier/GreenhouseFormSource.js';
import { Autopilot } from '../src/applier/Autopilot.js';
import type { FillVerifyStep, SubmitDriver, JobRef, BatchApproval } from '../src/applier/Autopilot.js';
import { Notifier } from '../src/applier/Notifier.js';
import { AnswerInbox } from '../src/applier/AnswerInbox.js';
import { AnswerKB, CompositeAnswerSource } from '../src/applier/AnswerKB.js';
import type { AnswerSource } from '../src/applier/IntentPayload.js';
import type { Answer, AnswerContext } from '../src/applier/AnswerGenerator.js';
import { EventStore } from '../src/store/EventStore.js';
import { SubmissionRecorder } from '../src/applier/SubmissionRecorder.js';
import { appIdFor } from '../src/store/events.js';

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

const IDENTITY: Record<string, string> = {
  'first name': 'Ada',
  'last name': 'Lovelace',
  'email': 'ada@example.com',
  'phone': '+1-555-0100',
  'address line 1': '1 Demo Street, San Jose, CA 95113',
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

const GPU_ANSWER = 'A fused FlashAttention kernel in Triton, 2.3x over the naive PyTorch baseline.';
const ANSWERS_FILE = path.resolve('tests/demo/fixtures/answers.demo.yml');
const GH_JOB = JSON.parse(fs.readFileSync(path.resolve('tests/demo/fixtures/greenhouse-job.json'), 'utf8'));

interface Portal {
  name: string;
  fixture: string;
  build(page: Page, answers: AnswerSource): { adapter: FillVerifyStep; submit: SubmitDriver };
}

const PORTALS: Portal[] = [
  {
    name: 'Workday',
    fixture: `file://${path.resolve('tests/demo/fixtures/workday-full.html')}`,
    build: (page, answers) => {
      const d = new WorkdayDriver(page);
      return { adapter: new WorkdayAdapter(d, answers), submit: d };
    },
  },
  {
    name: 'Greenhouse',
    fixture: `file://${path.resolve('tests/demo/fixtures/greenhouse-form.html')}`,
    build: (page, answers) => {
      const s = new GreenhouseFormSource(page, GH_JOB);
      return { adapter: new ApplicationAdapter(s, answers), submit: s };
    },
  },
];

async function runPortal(portal: Portal, browser: Browser, notifier: Notifier): Promise<boolean> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(C.bold(C.cyan(`  ${portal.name.toUpperCase()} — Demo Corp | ML Engineer Intern`)));
  console.log('═'.repeat(60));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `autopilot-${portal.name}-`));
  const resumePdf = path.join(tmp, 'resume-demo.pdf');
  fs.writeFileSync(resumePdf, '%PDF-1.4 demo bytes');

  const store = new EventStore(path.join(tmp, 'events.jsonl'));
  const recorder = new SubmissionRecorder(store, path.join(tmp, 'receipts'));
  const inbox = new AnswerInbox(path.join(tmp, 'pending.json'), path.join(tmp, 'learned.yml'));
  const buildAnswers = (): AnswerSource =>
    new CompositeAnswerSource([new AnswerKB(ANSWERS_FILE), inbox.learnedSource(), stubIdentity]);

  const job: JobRef = {
    appId: appIdFor('Demo Corp', `${portal.name} ML Intern`),
    company: 'Demo Corp',
    role: 'Machine Learning Engineer Intern',
    resumePdfPath: resumePdf,
    screenshotPaths: [],
  };
  const ctx: AnswerContext = { company: job.company, role: job.role };

  const page = await browser.newContext().then((c) => c.newPage());
  let submitted = false;

  try {
    await page.goto(portal.fixture, { waitUntil: 'domcontentloaded', timeout: 10_000 });

    // PASS 1 — autonomous, no approval.
    const p1 = portal.build(page, buildAnswers());
    const r1 = await new Autopilot({ adapter: p1.adapter, submit: p1.submit, notifier, inbox, store, recorder }).run(ctx, job);
    console.log(`  PASS 1 (autonomous) : ${C.bold(r1.phase.toUpperCase())}`);
    if (r1.phase === 'needs_input') {
      for (const p of r1.pending) console.log(`    ${C.yellow('⚑')} "${p.label}" ${C.dim('(real notification fired, no field filled)')}`);
      inbox.resolve(r1.pending[0]!.label, GPU_ANSWER);
      console.log(`    ${C.green('✓ answered')} -> learned (never unknown again)`);
    }

    // PASS 2 — resume with approval.
    const approval: BatchApproval = { approvedBy: 'parv', approvedAt: new Date().toISOString(), note: 'demo batch' };
    const p2 = portal.build(page, buildAnswers());
    const r2 = await new Autopilot({ adapter: p2.adapter, submit: p2.submit, notifier, inbox, store, recorder }).run(ctx, job, approval);
    console.log(`  PASS 2 (approved)   : ${C.bold(r2.phase.toUpperCase())}`);

    if (r2.phase === 'submitted') {
      for (const c of r2.verdict.checks) {
        const got = c.actual === null ? '<unread>' : c.actual;
        console.log(`    ${C.green('✓')} ${c.label.slice(0, 46).padEnd(46)} : ${C.green(got.slice(0, 40))}`);
      }
      console.log(`    ${C.green('SUBMITTED')} (fixture) — receipt ${r2.receipt.correlationId}, ${r2.receipt.atsConfirmation ?? '(no confirmation)'}`);
      console.log(`    ${C.dim('event log: ' + store.readAll().events.map((e) => e.type).join(' → '))}`);
      submitted = true;
    }

    fs.mkdirSync('output/demo', { recursive: true });
    await page.screenshot({ path: path.resolve('output/demo', `autopilot-${portal.name.toLowerCase()}.png`), fullPage: true }).catch(() => {});
  } finally {
    await page.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return submitted;
}

async function main(): Promise<void> {
  console.log(C.bold('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(C.bold('║   career-ops M4 — Autopilot across portals (one pipeline) ║'));
  console.log(C.bold('╚══════════════════════════════════════════════════════════╝'));
  console.log(C.dim('  Fixtures local, no network. Submit clicks a fixture button only.'));

  const browser = await chromium.launch({ headless: true });
  const notifier = new Notifier(); // real macOS banners
  const results: Record<string, boolean> = {};

  try {
    for (const portal of PORTALS) {
      results[portal.name] = await runPortal(portal, browser, notifier);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(C.bold('  SCORECARD'));
  let pass = 0;
  for (const [name, ok] of Object.entries(results)) {
    if (ok) pass++;
    console.log(`  ${ok ? C.green('PASS ✓') : C.red('FAIL ✗')}  ${name} — fill → verify → submit (fixture)`);
  }
  console.log(`  ${pass}/${Object.keys(results).length} portals through the same verify-or-abstain + submit pipeline\n`);

  process.exit(pass === PORTALS.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
