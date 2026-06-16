/**
 * M3 browser evidence: drive the real WorkdayDriver + WorkdayAdapter against
 * the local Workday fixture in headless Chromium, proving the verify-or-abstain
 * loop reads values back from a REAL DOM (not a fake driver).
 *
 * Usage: npm run demo:workday
 *
 * WHY a stub answer source (not config/profile.yml): this script runs in a
 * fresh clone with no personal data, and the values below are obvious
 * placeholders — no real PII is committed (secrets/PII policy). WHY no
 * recorder: a fixture exercise must not write to the production event log.
 * WHY this is separate from `npx vitest run`: it needs a browser, and the
 * gate stays browser-free (M0 fresh-clone lesson).
 *
 * NEVER submits: the adapter has no submit path. A green run stops at
 * "verified — human reviews and clicks Submit".
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { WorkdayDriver } from '../src/applier/WorkdayDriver.js';
import { WorkdayAdapter } from '../src/applier/WorkdayAdapter.js';
import type { AnswerSource } from '../src/applier/IntentPayload.js';
import type { Answer, AnswerContext } from '../src/applier/AnswerGenerator.js';

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// Obvious placeholder identity — NOT real PII. Matched by label substring,
// the same shape AnswerGenerator/AnswerKB use in production.
const DEMO: Record<string, string> = {
  'first name': 'Ada',
  'last name': 'Lovelace',
  'email': 'ada@example.com',
  'phone number': '+1-555-0100',
  'address line 1': '1 Demo Street, San Jose, CA 95113',
};

const stub: AnswerSource = {
  generate(question: string): Answer | null {
    const q = question.toLowerCase().trim();
    for (const [k, v] of Object.entries(DEMO)) {
      if (q.includes(k)) return { value: v, confidence: 'high', needsReview: false };
    }
    return null;
  },
};

const CTX: AnswerContext = { company: 'Demo Corp', role: 'Machine Learning Engineer Intern' };

async function main(): Promise<void> {
  console.log(C.bold('\n╔══════════════════════════════════════════════════════╗'));
  console.log(C.bold('║   career-ops M3 — Workday verify-or-abstain (fill)   ║'));
  console.log(C.bold('╚══════════════════════════════════════════════════════╝'));
  console.log(C.dim('  Fixture : tests/demo/fixtures/workday.html (local, no network)'));
  console.log(C.dim('  Driver  : real WorkdayDriver over headless Chromium'));
  console.log(C.dim('  Submit  : NEVER (adapter has no submit path)\n'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-wd-'));
  const resumePdf = path.join(tmp, 'resume-demo.pdf');
  fs.writeFileSync(resumePdf, '%PDF-1.4 demo bytes');

  const fixture = `file://${path.resolve('tests/demo/fixtures/workday.html')}`;
  const browser = await chromium.launch({ headless: true });
  let exitCode = 0;

  try {
    const page = await browser.newContext().then((c) => c.newPage());
    await page.goto(fixture, { waitUntil: 'domcontentloaded', timeout: 10_000 });

    const adapter = new WorkdayAdapter(new WorkdayDriver(page), stub);
    const outcome = await adapter.run(CTX, resumePdf);

    console.log(`  Outcome : ${C.bold(outcome.kind.toUpperCase())}\n`);

    if (outcome.kind === 'verified' || outcome.kind === 'verify_failed') {
      console.log(C.bold('  Field read-back verification (independent of fill):'));
      for (const c of outcome.verdict.checks) {
        const icon = c.pass ? C.green('✓') : C.red('✗');
        const got = c.actual === null ? '<unread>' : c.actual;
        console.log(
          c.pass
            ? `   ${icon} ${c.label.padEnd(18)} : ${C.green(got.slice(0, 50))}`
            : `   ${icon} ${c.label.padEnd(18)} : got ${C.red(`"${got.slice(0, 30)}"`)} expected ${C.yellow(`"${c.expected.slice(0, 30)}"`)}`
        );
      }
      if (outcome.kind === 'verified') {
        console.log(`\n  ${C.green('PASS')} — every field read back green. STOP: human reviews, then submits.`);
      } else {
        console.log(`\n  ${C.red('VERIFY FAILED')} — at least one field did not read back. Abstaining.`);
        exitCode = 1;
      }
    } else if (outcome.kind === 'abstained') {
      console.log(C.yellow('  Abstained — uncertain fields (no fill performed):'));
      for (const r of outcome.reasons) console.log(`   ${C.yellow('⚑')} ${r.label}: ${C.dim(r.why)}`);
      exitCode = 1;
    } else {
      console.log(C.yellow('  Auth wall detected — human login required before the form is reachable.'));
      exitCode = 1;
    }

    if ('eeo' in outcome && outcome.eeo.length > 0) {
      console.log(`\n  ${C.yellow('EEO / self-ID fields surfaced for the human (never auto-filled):')}`);
      for (const e of outcome.eeo) console.log(`   • ${e.label}`);
    }

    fs.mkdirSync('output/demo', { recursive: true });
    const shot = path.resolve('output/demo/workday-m3.png');
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
