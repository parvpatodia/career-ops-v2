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
 *   npm run run -- --preflight        read-only: classify each Ready job AUTO
 *                                     (hands-off submittable) vs ATTENDED (needs
 *                                     you). Scans only, never fills or submits.
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
import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { chromium } from 'playwright';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { AnswerInbox } from '../applier/AnswerInbox.js';
import { AnswerKB, CompositeAnswerSource } from '../applier/AnswerKB.js';
import { AnswerGenerator } from '../applier/AnswerGenerator.js';
import { EssayAnswerSource } from '../applier/EssayAnswerSource.js';
import { GeminiClient } from '../applier/GeminiClient.js';
import { AttendedFiller } from '../applier/AttendedFiller.js';
import type { AttendedResult } from '../applier/AttendedFiller.js';
import type { AnswerContext } from '../applier/AnswerGenerator.js';
import { ProfileLoader } from '../applier/ProfileLoader.js';
import { Notifier } from '../applier/Notifier.js';
import { Orchestrator } from './Orchestrator.js';
import type { ApplyGateResult } from './Orchestrator.js';
import { PlaywrightApplySessionFactory } from './PlaywrightApplySessionFactory.js';
import { GreenhouseBoardJobProvider } from './GreenhouseBoardJobFetcher.js';
import { Tailor } from '../tailor/Tailor.js';
import { isIneligible, jobFromApp, triageForm } from './queuePlanning.js';
import { IntentPayloadBuilder } from '../applier/IntentPayload.js';
import type { AnswerSource } from '../applier/IntentPayload.js';
import type { BatchApproval } from '../applier/Autopilot.js';
import type { Application } from '../types.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('run');

function printAttended(res: AttendedResult): void {
  if (res.kind === 'auth_required') {
    console.log('  🔒 Login wall — log in in the browser, then re-run.');
    return;
  }
  console.log(`  ✅ Filled + verified (${res.verified.length}): ${res.verified.map((f) => f.label).join(', ') || '(none)'}`);
  if (res.verifyFailed.length > 0) {
    console.log(`  ⚠️  Filled but NOT verified — recheck: ${res.verifyFailed.map((f) => `${f.label} (got "${String(f.readBack).slice(0, 24)}")`).join(', ')}`);
  }
  if (res.needsHuman.length > 0) {
    console.log(`  ✋ You complete (${res.needsHuman.length}):`);
    for (const h of res.needsHuman) console.log(`       • ${h.label.slice(0, 70)}  — ${h.why}`);
  }
}

function reportApply(app: Application, result: ApplyGateResult): void {
  switch (result.phase) {
    case 'submitted':
      console.log(`  ✅ SUBMITTED — receipt ${result.receipt.correlationId}, ${result.receipt.atsConfirmation ?? '(no confirmation)'}`);
      break;
    case 'ready_to_submit':
      console.log(`  🟢 READY TO SUBMIT — verified green, filled and stopped. Re-run with --approve to submit.`);
      break;
    case 'submit_unconfirmed':
      console.log(`  ⚠️  SUBMIT UNCONFIRMED — clicked submit but the ATS gave NO confirmation. NOT recorded as applied. Open ${app.url} and finish/verify it by hand.`);
      break;
    case 'needs_input':
      console.log(`  ✋ NEEDS INPUT — ${result.pending.length} unknown question(s) flagged + notified:`);
      for (const p of result.pending) console.log(`       • "${p.label}"`);
      console.log(`     Answer them (config/answers.learned.yml is written on resolve), then re-run.`);
      break;
    case 'verify_failed': {
      console.log(`  ❌ VERIFY FAILED — read-back did not match; NOT submitted. Mismatches:`);
      for (const c of result.verdict.checks.filter((c) => !c.pass)) {
        console.log(`       • ${c.label}: wanted "${String(c.expected).slice(0, 50)}" got "${String(c.actual).slice(0, 50)}"`);
      }
      break;
    }
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
  const useAttended = args.includes('--attended');
  const usePreflight = args.includes('--preflight');
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
  // One shared essay source (its LLM cache persists across passes). Order:
  // human-approved KB, learned answers, company-specific essay (LLM-prewarmed,
  // deterministic fallback), then the standard generator.
  const gemini = new GeminiClient();
  const essaySource = new EssayAnswerSource(profileLoader!, gemini);
  if (gemini.enabled) log.info('Gemini essay generation enabled (gemini-2.5-flash)');
  const answers = (): AnswerSource =>
    new CompositeAnswerSource([
      new AnswerKB(),
      inbox.learnedSource(),
      essaySource,
      new AnswerGenerator(profileLoader!),
    ]);

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
    essays: essaySource, // async LLM essay pre-warm before each fill
  });

  const approval: BatchApproval | undefined = useApprove
    ? { approvedBy: 'parv', approvedAt: new Date().toISOString(), note: 'run --approve' }
    : undefined;

  console.log(`\nProcessing ${queue.length} application(s)  [${useApprove ? 'APPROVE→submit verified' : 'fill+verify, no submit'}${useTailor ? ', re-tailor' : ''}]`);
  if (!useApprove) console.log('Forms will be filled and verified, then STOPPED. Re-run with --approve to submit.\n');

  let submitted = 0;
  try {
    // ── Preflight (read-only): classify each Ready job AUTO vs ATTENDED ──
    // Scans + builds the payload only. NEVER fills, NEVER submits. Tells you
    // which forms --approve can take hands-off and which need --attended.
    if (usePreflight) {
      console.log('Preflight (read-only): AUTO = predicted hands-off submittable via --approve; ATTENDED = needs you.\n');
      let auto = 0;
      let attended = 0;
      for (let i = 0; i < queue.length; i++) {
        const app = queue[i]!;
        process.stdout.write(`[${i + 1}/${queue.length}] ${app.company} — ${app.role}\n`);
        const opened = await sessions.open(app, answers());
        if (!opened.ok) { console.log(`     → ATTENDED (unsupported ATS "${opened.ats}")\n`); attended++; continue; }
        if (!opened.session.source) { console.log('     → ATTENDED (no form source)\n'); attended++; await opened.session.close(); continue; }
        const ctx: AnswerContext = {
          company: app.company, role: app.role, resumeVariant: app.resumeVariant,
          ...(app.jd ? { jd: app.jd } : {}),
        };
        try {
          if (await opened.session.source.isAuthWall()) { console.log('     → ATTENDED (login wall)\n'); attended++; continue; }
          await essaySource.prewarm(ctx).catch(() => {});
          const schema = await opened.session.source.scanSchema();
          const payload = new IntentPayloadBuilder(answers()).build(schema.fields, ctx, app.pdfPath);
          const verdict = triageForm({
            hasCaptcha: !!schema.captcha,
            requiredUnmapped: schema.unmapped.filter((u) => u.required).length,
            unknownQuestions: payload.reasons.length,
            fillableFields: payload.intents.length,
          });
          if (verdict.mode === 'auto') {
            auto++;
            console.log(`     → AUTO — ${payload.intents.length} field(s) would fill + verify; re-run with --approve --job ${app.id}\n`);
          } else {
            attended++;
            console.log(`     → ATTENDED — ${verdict.reasons.join('; ')}`);
            // Name WHAT needs a human, so the AnswerKB can be grown (mission:
            // intervention trends to zero as approved answers accumulate).
            if (schema.captcha) console.log(`         · captcha: ${schema.captcha.kind} (you solve it)`);
            for (const r of payload.reasons) console.log(`         · unknown: ${r.label.replace(/\s+/g, ' ').slice(0, 80)}`);
            for (const u of schema.unmapped.filter((u) => u.required)) console.log(`         · unmapped(${u.widget}): ${u.label.replace(/\s+/g, ' ').slice(0, 70)}`);
            console.log(`       (${payload.intents.length} field(s) WOULD fill + verify automatically)\n`);
          }
        } catch (err) {
          attended++;
          console.log(`     → ATTENDED (scan error: ${(err as Error).message})\n`);
        } finally {
          await opened.session.close();
        }
      }
      console.log(`═══ Preflight: ${auto} AUTO (--approve hands-off), ${attended} ATTENDED (--attended). ═══\n`);
      return;
    }

    // ── Attended mode: system fills + verifies what it can, you finish + submit ──
    if (useAttended) {
      const rl = process.stdin.isTTY ? createInterface({ input: stdin, output: stdout }) : null;
      console.log(`Attended: I fill + verify what I safely can in the visible browser; you complete the flagged items, solve any captcha, and click Submit.\n`);
      for (let i = 0; i < queue.length; i++) {
        const app = queue[i]!;
        console.log(`\n[${i + 1}/${queue.length}] ${app.company} — ${app.role}  (id ${app.id})`);
        const opened = await sessions.open(app, answers());
        if (!opened.ok) { console.log(`  ⏭  unsupported ATS "${opened.ats}" — open manually: ${app.url}`); continue; }
        if (!opened.session.source) { console.log('  (no form source available)'); await opened.session.close(); continue; }
        const ctx: AnswerContext = {
          company: app.company, role: app.role, resumeVariant: app.resumeVariant,
          ...(app.jd ? { jd: app.jd } : {}),
        };
        await essaySource.prewarm(ctx).catch(() => {});
        try {
          const res = await new AttendedFiller(opened.session.source, answers()).fill(ctx, app.pdfPath);
          printAttended(res);
          if (res.kind === 'filled' && rl) {
            await rl.question('  → Finish the flagged items + captcha in the browser, click Submit, then press Enter (s to skip): ');
            const did = await rl.question('  → Did you submit it? (y/n): ');
            if (did.trim().toLowerCase() === 'y') {
              store.update(app.id, { status: 'Applied', appliedAt: new Date().toISOString() });
              submitted++;
              console.log('  ✓ marked Applied. `npm run inbox` will confirm from the email.');
            }
          } else if (res.kind === 'filled') {
            console.log('  (non-interactive: review above; re-run in a terminal to complete + submit.)');
          }
        } catch (err) {
          console.log(`  ⚠️  fill error: ${(err as Error).message}`);
        } finally {
          await opened.session.close();
        }
      }
      rl?.close();
      console.log(`\n═══ Attended done. Marked applied this run: ${submitted}/${queue.length}. ═══\n`);
      return;
    }

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
