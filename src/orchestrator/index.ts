/**
 * `npm run run` — the integrated apply entry point (M7). The v2 replacement for
 * the legacy `npm run apply`: it drives the Ready queue through the Orchestrator,
 * which composes the verify-or-abstain apply engine (M4/M3.5), the answer KB +
 * self-improving inbox, desktop notifications, and the single event log.
 *
 * Usage:
 *   npm run run                       fill + INDEPENDENTLY verify each Ready job,
 *                                     STOP at ready_to_submit. Never submits.
 *   npm run run -- --approve          submit each job that verifies green (the
 *                                     "click of a button"); still gated on a
 *                                     verified verdict by the Autopilot.
 *   npm run run -- --tailor           re-tailor each job with the M6 Tailor
 *                                     (verify-or-abstain) before applying.
 *   npm run run -- --batch 10         how many Ready jobs to process (default 5).
 *   npm run run -- --job 007          one application by id (or jobId).
 *   npm run run -- --stats            queue breakdown, no browser.
 *
 * HARD RULES (AGENTS.md): submit happens ONLY with --approve AND only after an
 * independent verified verdict. An unknown question / captcha / auth wall / an
 * unsupported ATS ABSTAINS and notifies; nothing is ever guessed. Idempotent:
 * a submitted application is never re-touched.
 *
 * Requires config/profile.yml + config/answers.yml (gitignored, present on
 * Parv's machine). Real PII never enters the repo or tests.
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { AnswerInbox } from '../applier/AnswerInbox.js';
import { AnswerKB, CompositeAnswerSource } from '../applier/AnswerKB.js';
import { AnswerGenerator } from '../applier/AnswerGenerator.js';
import { ProfileLoader } from '../applier/ProfileLoader.js';
import { Notifier } from '../applier/Notifier.js';
import { Orchestrator } from './Orchestrator.js';
import type { ApplyGateResult } from './Orchestrator.js';
import { PlaywrightApplySessionFactory } from './PlaywrightApplySessionFactory.js';
import { GreenhouseBoardJobProvider } from './GreenhouseBoardJobFetcher.js';
import { Tailor } from '../tailor/Tailor.js';
import { isIneligible, jobFromApp } from './queuePlanning.js';
import type { AnswerSource } from '../applier/IntentPayload.js';
import type { BatchApproval } from '../applier/Autopilot.js';
import type { Application } from '../types.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('run');

function reportApply(app: Application, result: ApplyGateResult): void {
  switch (result.phase) {
    case 'submitted':
      console.log(`  ✅ SUBMITTED — receipt ${result.receipt.correlationId}, ${result.receipt.atsConfirmation ?? '(no confirmation)'}`);
      break;
    case 'ready_to_submit':
      console.log(`  🟢 READY TO SUBMIT — verified green, filled and stopped. Re-run with --approve to submit.`);
      break;
    case 'needs_input':
      console.log(`  ✋ NEEDS INPUT — ${result.pending.length} unknown question(s) flagged + notified:`);
      for (const p of result.pending) console.log(`       • "${p.label}"`);
      console.log(`     Answer them (config/answers.learned.yml is written on resolve), then re-run.`);
      break;
    case 'verify_failed':
      console.log(`  ❌ VERIFY FAILED — read-back did not match; NOT submitted. Review the form.`);
      break;
    case 'auth_required':
      console.log(`  🔒 AUTH REQUIRED — log in / solve the captcha, then re-run (it resumes).`);
      break;
    case 'unsupported_ats':
      console.log(`  ⏭  UNSUPPORTED ATS "${result.ats}" — abstained (no verified filler). Apply manually: ${app.url}`);
      break;
    case 'already_submitted':
      console.log(`  ↩  ALREADY SUBMITTED — skipped (idempotent).`);
      break;
  }
}

function printStats(store: ApplicationStore): void {
  const apps = store.getAll();
  const byStatus: Record<string, number> = {};
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  console.log('\nApplication Queue:');
  for (const [status, count] of Object.entries(byStatus).sort()) {
    console.log(`  ${status.padEnd(12)} ${String(count).padStart(4)}`);
  }
  console.log(`\n  Total: ${apps.length}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const store = new ApplicationStore();

  if (args.includes('--stats')) {
    printStats(store);
    return;
  }

  const useApprove = args.includes('--approve');
  const useTailor = args.includes('--tailor');
  const batchIdx = args.indexOf('--batch');
  const batchSize = batchIdx !== -1 ? parseInt(args[batchIdx + 1] ?? '5', 10) : 5;
  const jobIdx = args.indexOf('--job');
  const targetId = jobIdx !== -1 ? (args[jobIdx + 1] ?? null) : null;

  // Select the work: a single id, or the next N Ready (F-1-eligible) jobs.
  let queue: Application[];
  if (targetId) {
    const found = store.getAll().find((a) => a.id === targetId || a.jobId === targetId);
    if (!found) { log.error(`Application "${targetId}" not found`); process.exit(1); }
    queue = [found!];
  } else {
    let ready = store.getByStatus('Ready');
    const skipped = ready.filter(isIneligible);
    if (skipped.length > 0) log.info(`Auto-skipping ${skipped.length} job(s) requiring US citizenship/clearance (F-1)`);
    ready = ready.filter((a) => !isIneligible(a));
    queue = ready.slice(0, batchSize);
  }

  if (queue.length === 0) {
    log.info('Queue is empty. Run the sourcing pipeline first to populate Ready jobs.');
    printStats(store);
    return;
  }

  // Profile + answers are required to fill forms. Fail loudly if absent.
  let profileLoader: ProfileLoader;
  try {
    profileLoader = new ProfileLoader();
  } catch (err) {
    log.error(`config/profile.yml is required to fill applications: ${(err as Error).message}`);
    process.exit(1);
  }

  const inbox = new AnswerInbox();
  const notifier = new Notifier();
  const answers = (): AnswerSource =>
    new CompositeAnswerSource([new AnswerKB(), inbox.learnedSource(), new AnswerGenerator(profileLoader!)]);

  const headless = process.env.CAREER_OPS_HEADLESS === '1';
  const browser = await chromium.launch({ headless });
  const greenhouseProvider = new GreenhouseBoardJobProvider();
  const sessions = new PlaywrightApplySessionFactory({
    browser,
    greenhouseJob: (app) => greenhouseProvider.provide(app),
  });

  const orch = new Orchestrator({
    ...(useTailor ? { tailor: new Tailor() } : {}),
    apps: store,
    notifier,
    inbox,
    answers,
    sessions,
  });

  const approval: BatchApproval | undefined = useApprove
    ? { approvedBy: 'parv', approvedAt: new Date().toISOString(), note: 'run --approve' }
    : undefined;

  console.log(`\nProcessing ${queue.length} application(s)  [${useApprove ? 'APPROVE→submit verified' : 'fill+verify, no submit'}${useTailor ? ', re-tailor' : ''}]`);
  if (!useApprove) console.log('Forms will be filled and verified, then STOPPED. Re-run with --approve to submit.\n');

  let submitted = 0;
  try {
    for (let i = 0; i < queue.length; i++) {
      const app = queue[i]!;
      console.log(`\n[${i + 1}/${queue.length}] ${app.company} — ${app.role}  (id ${app.id}, ${app.url})`);

      let result: ApplyGateResult;
      if (useTailor) {
        const { job, evaluation } = jobFromApp(app);
        const advanced = await orch.advance(job, evaluation, { apply: true, ...(approval ? { approval } : {}) });
        if (advanced.tailor.phase === 'tailor_abstained') {
          console.log(`  ⚠️  TAILOR ABSTAINED — ${advanced.tailor.reason}. Not applied.`);
          continue;
        }
        if (!advanced.apply) { console.log(`  (tailored, not applied: ${advanced.tailor.phase})`); continue; }
        result = advanced.apply;
      } else {
        result = await orch.apply(app, approval ? { approval } : {});
      }

      reportApply(app, result);
      if (result.phase === 'submitted') submitted++;
    }
  } finally {
    await browser.close();
  }

  console.log(`\n═══ Done. Submitted this run: ${submitted}/${queue.length}. ═══\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
