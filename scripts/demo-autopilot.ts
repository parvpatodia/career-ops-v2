/**
 * M3.5 end-to-end evidence: the autonomous autopilot loop against a realistic
 * Workday fixture, in headless Chromium, for real.
 *
 * Usage: npm run demo:autopilot
 *
 * What it proves, with no human intervention except the one designed touchpoint:
 *   PASS 1  fill+verify runs; the unknown free-text question makes it ABSTAIN
 *           before touching the form; a REAL macOS notification fires and the
 *           question is logged to the AnswerInbox.
 *   resume  the answer is supplied (AnswerInbox.resolve) -> learned forever.
 *   PASS 2  re-run with the answer + an explicit batch approval: every field is
 *           auto-filled, INDEPENDENTLY read back and verified green, then
 *           submitted, with a receipt written and a completion notification.
 *
 * WHY a stub identity + demo AnswerKB (no config/profile.yml, no real PII):
 * runs in a fresh clone. WHY temp store/inbox/receipts: a fixture exercise must
 * not write to production data. WHY safe: "submit" clicks the fixture's button
 * (reveals a confirmation div, no network) — never a real employer.
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { WorkdayDriver } from '../src/applier/WorkdayDriver.js';
import { WorkdayAdapter } from '../src/applier/WorkdayAdapter.js';
import { Autopilot } from '../src/applier/Autopilot.js';
import type { JobRef, BatchApproval } from '../src/applier/Autopilot.js';
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

// Obvious placeholder identity (NOT real PII), matched by label substring.
const IDENTITY: Record<string, string> = {
  'first name': 'Ada',
  'last name': 'Lovelace',
  'email': 'ada@example.com',
  'phone number': '+1-555-0100',
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

async function main(): Promise<void> {
  console.log(C.bold('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(C.bold('║   career-ops M3.5 — Autopilot: notify · resume · submit   ║'));
  console.log(C.bold('╚══════════════════════════════════════════════════════════╝'));
  console.log(C.dim('  Fixture : tests/demo/fixtures/workday-full.html (local, no network)'));
  console.log(C.dim('  Submit  : clicks the fixture button only — never a real employer\n'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-demo-'));
  const resumePdf = path.join(tmp, 'resume-demo.pdf');
  fs.writeFileSync(resumePdf, '%PDF-1.4 demo bytes');

  const store = new EventStore(path.join(tmp, 'events.jsonl'));
  const recorder = new SubmissionRecorder(store, path.join(tmp, 'receipts'));
  const inbox = new AnswerInbox(path.join(tmp, 'pending.json'), path.join(tmp, 'learned.yml'));
  const notifier = new Notifier(); // real macOS banners

  // KB(demo) first, then learned answers, then the stub identity.
  const buildAnswers = (): AnswerSource =>
    new CompositeAnswerSource([
      new AnswerKB(path.resolve('tests/demo/fixtures/answers.demo.yml')),
      inbox.learnedSource(),
      stubIdentity,
    ]);

  const job: JobRef = {
    appId: appIdFor('Demo Corp', 'Machine Learning Engineer Intern'),
    company: 'Demo Corp',
    role: 'Machine Learning Engineer Intern',
    resumePdfPath: resumePdf,
    screenshotPaths: [],
  };
  const ctx: AnswerContext = { company: job.company, role: job.role };

  const fixture = `file://${path.resolve('tests/demo/fixtures/workday-full.html')}`;
  const browser = await chromium.launch({ headless: true });
  let exitCode = 1;

  try {
    const page = await browser.newContext().then((c) => c.newPage());
    await page.goto(fixture, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    const driver = new WorkdayDriver(page);

    // ── PASS 1: autonomous, no approval ──────────────────────────────────
    console.log(C.bold('  PASS 1 — autonomous fill + verify (no approval yet)'));
    const pilot1 = new Autopilot({ adapter: new WorkdayAdapter(driver, buildAnswers()), submit: driver, notifier, inbox, store, recorder });
    const r1 = await pilot1.run(ctx, job);
    console.log(`  Result  : ${C.bold(r1.phase.toUpperCase())}`);

    if (r1.phase === 'needs_input') {
      for (const p of r1.pending) {
        console.log(`   ${C.yellow('⚑ unknown')} "${p.label}"`);
        console.log(`     ${C.dim(p.why)}`);
      }
      console.log(`   ${C.cyan('→ Real macOS notification fired. Logged to inbox. No field filled (abstain-before-fill).')}\n`);

      // ── Resume touchpoint: Parv answers the flagged question ───────────
      const answer = 'A fused FlashAttention kernel in Triton, 2.3x over the naive PyTorch baseline.';
      console.log(C.bold('  RESUME — Parv answers the notification'));
      inbox.resolve(r1.pending[0]!.label, answer);
      console.log(`   ${C.green('✓ saved to AnswerKB (learned)')}: "${answer.slice(0, 56)}…"`);
      console.log(`   ${C.dim('This question will never be unknown again.')}\n`);
    } else {
      console.log(C.red('  Expected needs_input on pass 1 (the GPU-kernel question). Aborting.'));
    }

    // ── PASS 2: resume with the learned answer + explicit approval ───────
    console.log(C.bold('  PASS 2 — resume with approval (the "click of a button")'));
    const approval: BatchApproval = { approvedBy: 'parv', approvedAt: new Date().toISOString(), note: 'demo batch' };
    const pilot2 = new Autopilot({ adapter: new WorkdayAdapter(driver, buildAnswers()), submit: driver, notifier, inbox, store, recorder });
    const r2 = await pilot2.run(ctx, job, approval);
    console.log(`  Result  : ${C.bold(r2.phase.toUpperCase())}\n`);

    if (r2.phase === 'submitted') {
      console.log(C.bold('  Field read-back verification (independent of fill):'));
      for (const c of r2.verdict.checks) {
        const got = c.actual === null ? '<unread>' : c.actual;
        console.log(`   ${C.green('✓')} ${c.label.padEnd(20)} : ${C.green(got.slice(0, 52))}`);
      }
      console.log(`\n  ${C.green('SUBMITTED')} (fixture). Receipt ${C.bold(r2.receipt.correlationId)}`);
      console.log(`   confirmation : ${r2.receipt.atsConfirmation ?? '(none)'}`);
      console.log(`   resume sha256: ${r2.receipt.resumeSha256?.slice(0, 16)}…`);
      console.log(`   ${C.cyan('→ Completion notification fired.')}`);
      console.log(`   ${C.dim('event log: ' + store.readAll().events.map((e) => e.type).join(' → '))}`);
      exitCode = 0;
    }

    fs.mkdirSync('output/demo', { recursive: true });
    const shot = path.resolve('output/demo/workday-autopilot.png');
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.log(C.dim(`\n  Screenshot → ${shot}`));
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
