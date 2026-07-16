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
 *   npm run run -- --auto             hybrid loop: submit captcha-free verified
 *                                     forms hands-off; on a captcha or an unknown
 *                                     question, notify + bring the live Chrome
 *                                     window to the front + WATCH the page for
 *                                     your submit, then resume. Headed; no TTY
 *                                     needed (auto-detects). THE everyday command.
 *   npm run run -- --tailor           re-tailor each job with the M6 Tailor
 *                                     (verify-or-abstain) before applying.
 *   npm run run -- --batch 10         how many Ready jobs to process (default 5).
 *   npm run run -- --job 007          one application by id (or jobId).
 *   npm run run -- --preflight        read-only: classify each Ready job AUTO
 *                                     (hands-off submittable) vs ATTENDED (needs
 *                                     you). Scans only, never fills or submits.
 *                                     Add --learn to record each unknown question
 *                                     to the answer inbox for one-time approval.
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
import { launchChrome, frontmostApp, restoreApp } from '../applier/browserLaunch.js';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { AnswerInbox } from '../applier/AnswerInbox.js';
import { AnswerKB, CompositeAnswerSource } from '../applier/AnswerKB.js';
import { AnswerGenerator } from '../applier/AnswerGenerator.js';
import { EssayAnswerSource } from '../applier/EssayAnswerSource.js';
import { GeminiClient } from '../applier/GeminiClient.js';
import { AttendedFiller } from '../applier/AttendedFiller.js';
import type { AttendedResult } from '../applier/AttendedFiller.js';
import { confirmViaTransition } from '../applier/waitForConfirmation.js';
import type { AnswerContext } from '../applier/AnswerGenerator.js';
import { ProfileLoader } from '../applier/ProfileLoader.js';
import { Notifier } from '../applier/Notifier.js';
import { Orchestrator } from './Orchestrator.js';
import type { ApplyGateResult, ApplySessionFactory } from './Orchestrator.js';
import { PlaywrightApplySessionFactory } from './PlaywrightApplySessionFactory.js';
import { GreenhouseBoardJobProvider } from './GreenhouseBoardJobFetcher.js';
import { Tailor } from '../tailor/Tailor.js';
import { isIneligible, jobFromApp, triageForm } from './queuePlanning.js';
import { IntentPayloadBuilder } from '../applier/IntentPayload.js';
import type { AnswerSource } from '../applier/IntentPayload.js';
import type { BatchApproval } from '../applier/Autopilot.js';
import type { Application } from '../types.js';
import { SubmissionRecorder } from '../applier/SubmissionRecorder.js';
import { appIdFor } from '../store/events.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('run');

// --auto background resume: after the window is surfaced for a captcha/field, the
// loop watches the live page for the REAL ATS confirmation (the human's submit)
// rather than prompting in the terminal, so it needs no TTY and pops the window
// only at a touchpoint. Give a human ~5 min to solve + submit; poll every 4s.
// WHY Number.isFinite: a malformed env value -> parseInt NaN -> Math.max(x,NaN)
// is NaN, and a NaN timeout makes waitForConfirmation poll forever (now()>=NaN is
// always false). Fall back to the default rather than hang the takeover.
const AUTO_RESUME_TIMEOUT_MS = (() => {
  const parsed = parseInt(process.env.CAREER_OPS_RESUME_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(5_000, parsed) : 5 * 60_000;
})();
const AUTO_RESUME_POLL_MS = 4_000;

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

/**
 * Attended takeover for ONE application: open a VISIBLE Chrome session, fill +
 * verify only what is safe (AttendedFiller), bring the window to the front, and
 * wait while Parv solves the captcha / answers the flagged questions and clicks
 * Submit. Marks the app Applied only if Parv confirms he submitted. Returns
 * whether it was marked Applied. Shared by --attended (every job) and --auto
 * (only on a human touchpoint). NEVER auto-submits: the human owns the click.
 */
async function attendedTakeover(
  app: Application,
  sessions: ApplySessionFactory,
  answers: () => AnswerSource,
  essaySource: EssayAnswerSource,
  store: ApplicationStore,
  rl: ReturnType<typeof createInterface> | null,
  autoResume?: { timeoutMs: number; intervalMs: number },
  hooks?: { afterOpen?: () => Promise<void>; onTouchpoint?: (app: Application) => void }
): Promise<boolean> {
  const opened = await sessions.open(app, answers());
  if (!opened.ok) { console.log(`  ⏭  unsupported ATS "${opened.ats}" — open manually: ${app.url}`); return false; }
  if (!opened.session.source) { console.log('  (no form source available)'); await opened.session.close(); return false; }
  // Push the just-opened window BEHIND the user's work so the autofill does not
  // steal focus; only the touchpoint below raises Chrome (background --auto).
  await hooks?.afterOpen?.();
  const ctx: AnswerContext = {
    company: app.company, role: app.role, resumeVariant: app.resumeVariant,
    ...(app.jd ? { jd: app.jd } : {}),
  };
  await essaySource.prewarm(ctx).catch(() => {});
  try {
    const res = await new AttendedFiller(opened.session.source, answers()).fill(ctx, app.pdfPath);
    printAttended(res);
    if (res.kind === 'filled' && autoResume) {
      // Background resume (no TTY): surface the window, then confirm a real submit
      // by a null -> confirmed TRANSITION only. confirmViaTransition reads a
      // baseline first and refuses to trust a page that already reads "confirmed"
      // while UNSUBMITTED (Greenhouse/Generic's loose body+URL fallback), so a job
      // is marked Applied only on an OBSERVED submit (invariant 1: never claim a
      // submit we cannot observe). Unit-tested in waitForConfirmation.test.ts.
      // Touchpoint: NOW is the only moment we surface the window (+ a banner),
      // matching "only show when I have to click Submit".
      hooks?.onTouchpoint?.(app);
      await opened.session.focus?.();
      console.log('  → Chrome is in front. Solve the captcha + finish any flagged field + click Submit; watching for the confirmation…');
      const outcome = await confirmViaTransition({
        readConfirmation: () => opened.session.submit.readConfirmation(),
        timeoutMs: autoResume.timeoutMs,
        intervalMs: autoResume.intervalMs,
      });
      if (outcome.kind === 'confirmed') {
        store.update(app.id, { status: 'Applied', appliedAt: new Date().toISOString() });
        // Persist the OBSERVED ATS confirmation as a `confirmed` event (proof).
        // store.update already appended `submitted`, satisfying the projection's
        // confirmed-requires-submitted rule. Best-effort: the Applied status is
        // already durable, so a confirmation-append hiccup must not undo it.
        try {
          const appId = appIdFor(app.company, app.role);
          new SubmissionRecorder(store.eventStore()).recordConfirmation(
            appId,
            `auto-${appId}-${Date.now()}`,
            outcome.confirmation
          );
        } catch (err) {
          console.log(`  (Applied recorded; confirmation-event append skipped: ${(err as Error).message})`);
        }
        console.log(`  ✅ confirmed + marked Applied: ${outcome.confirmation.slice(0, 80)}`);
        return true;
      }
      if (outcome.kind === 'unreliable') {
        console.log('  ⚠️  this form reads as "submitted" before you even act, so I can\'t reliably auto-detect your submit — left Ready; complete + verify it yourself.');
      } else {
        console.log(`  ⏳ no confirmation within ${Math.round(autoResume.timeoutMs / 60_000)}m — left Ready; the loop resurfaces it next cycle.`);
      }
    } else if (res.kind === 'filled' && rl) {
      // Interactive (--attended): bring the Chrome window to the front; the macOS
      // banner only opens Script Editor, so the window itself is the handoff.
      await opened.session.focus?.();
      console.log('  → Chrome is now in front. Solve the captcha + finish any flagged field there.');
      await rl.question('  → When done in the browser, click Submit, then press Enter (s to skip): ');
      const did = await rl.question('  → Did you submit it? (y/n): ');
      if (did.trim().toLowerCase() === 'y') {
        store.update(app.id, { status: 'Applied', appliedAt: new Date().toISOString() });
        console.log('  ✓ marked Applied. `npm run inbox` will confirm from the email.');
        return true;
      }
    } else if (res.kind === 'filled') {
      console.log('  (non-interactive: review above; re-run in a terminal to complete + submit.)');
    }
  } catch (err) {
    console.log(`  ⚠️  fill error: ${(err as Error).message}`);
  } finally {
    await opened.session.close();
  }
  return false;
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
  const useAuto = args.includes('--auto');
  const usePreflight = args.includes('--preflight');
  // --tailor only takes effect on the default apply path (orch.advance). The
  // attended/auto paths submit the queue's already-M6-tailored resume directly,
  // so a passed --tailor would be silently dropped: warn instead of surprising.
  if (useTailor && (useAuto || useAttended)) {
    log.warn('--tailor is not applied in --auto/--attended; the queue resume (already M6-tailored by `npm run source`) is used as-is. Run `npm run source` to refresh tailoring first.');
  }
  // --learn (with --preflight): record each unknown question to the AnswerInbox
  // as pending, so a human can approve it once and it is learned forever. Only
  // records the QUESTION — never an answer (no fabrication; invariant 7).
  const useLearn = args.includes('--learn');
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

  // --auto is a two-phase SEQUENTIAL flow: phase 1 (the autonomous pass) runs
  // HEADLESS so nothing appears on screen; phase 2 (the human takeover) opens a
  // headed window ONLY after the headless browser is closed. Never two Chromes at
  // once — a concurrent headed+headless channel:'chrome' hits Chrome's single-
  // instance behavior and the takeover page closes mid-fill (2026-07-15). So the
  // main browser is headless for --auto. --attended is headed throughout; other
  // modes honor CAREER_OPS_HEADLESS.
  const headless = useAttended ? false : (useAuto ? true : process.env.CAREER_OPS_HEADLESS === '1');
  const { browser, usingChrome } = await launchChrome({ headless });
  log.info(usingChrome ? 'Using your Google Chrome' : 'Chrome not found — fell back to bundled Chromium');
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

  // --auto implies approval: its whole point is to submit the captcha-free,
  // verified subset hands-off. The Autopilot still gates every submit on an
  // independent verified verdict, so the approval only authorizes, never forces.
  const approval: BatchApproval | undefined = (useApprove || useAuto)
    ? { approvedBy: 'parv', approvedAt: new Date().toISOString(), note: useAuto ? 'run --auto' : 'run --approve' }
    : undefined;

  // The specialized branches (preflight/attended/auto) print their own banner.
  if (!usePreflight && !useAttended && !useAuto) {
    console.log(`\nProcessing ${queue.length} application(s)  [${useApprove ? 'APPROVE→submit verified' : 'fill+verify, no submit'}${useTailor ? ', re-tailor' : ''}]`);
    if (!useApprove) console.log('Forms will be filled and verified, then STOPPED. Re-run with --approve to submit.\n');
  }

  let submitted = 0;
  try {
    // ── Preflight (read-only): classify each Ready job AUTO vs ATTENDED ──
    // Scans + builds the payload only. NEVER fills, NEVER submits. Tells you
    // which forms --approve can take hands-off and which need --attended.
    if (usePreflight) {
      console.log('Preflight (read-only): AUTO = predicted hands-off submittable via --approve; ATTENDED = needs you.');
      if (useLearn) console.log('--learn: recording each unknown question to the answer inbox (questions only, never answers).');
      console.log('');
      let auto = 0;
      let attended = 0;
      let flagged = 0;
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
            for (const r of payload.reasons) {
              console.log(`         · unknown: ${r.label.replace(/\s+/g, ' ').slice(0, 80)}`);
              // flag() dedups by normalized question + skips already-learned ones.
              if (useLearn && inbox.flag(r.label, ctx, r.why)) flagged++;
            }
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
      console.log(`═══ Preflight: ${auto} AUTO (--approve hands-off), ${attended} ATTENDED (--attended). ═══`);
      if (useLearn) {
        console.log(`Flagged ${flagged} new question(s) to the answer inbox (data/pending-answers.json).`);
        console.log(`Approve them once (MCP resolve_answer, or config/answers.learned.yml); they auto-fill next run.\n`);
      } else {
        console.log('');
      }
      return;
    }

    // ── Attended mode: system fills + verifies what it can, you finish + submit ──
    if (useAttended) {
      const rl = process.stdin.isTTY ? createInterface({ input: stdin, output: stdout }) : null;
      console.log(`Attended (Google Chrome): I fill + verify what I safely can, then bring the Chrome window to the front for you. Solve any captcha + finish flagged fields THERE and click Submit. (Ignore the macOS banner — it opens Script Editor, not the browser.)\n`);
      for (let i = 0; i < queue.length; i++) {
        const app = queue[i]!;
        console.log(`\n[${i + 1}/${queue.length}] ${app.company} — ${app.role}  (id ${app.id})`);
        if (await attendedTakeover(app, sessions, answers, essaySource, store, rl)) submitted++;
      }
      rl?.close();
      console.log(`\n═══ Attended done. Marked applied this run: ${submitted}/${queue.length}. ═══\n`);
      return;
    }

    // ── Auto (hybrid): hands-off where it can, hands you the wheel where it must ──
    // Per Ready job, run the SAME gated autonomous path as --approve (orch.apply
    // with approval). If it submits, done. If it stops at a captcha (auth_required)
    // or an unknown question (needs_input), the two designed human touchpoints
    // (already notified by the Autopilot), bring the live Chrome window to the
    // front and wait while Parv finishes + submits, then resume the loop. This is
    // the "autonomous until a human is needed, then surface the page + resume"
    // command. WHY a fresh session for the takeover: orch.apply closes its page on
    // return, so the takeover reopens a visible session on the SAME app (a few
    // seconds' reload, only on the jobs a human handles anyway). Submit stays in
    // ONE place (the Autopilot); the takeover never auto-submits.
    if (useAuto) {
      console.log(`Auto (hybrid): the autonomous pass runs HEADLESS (nothing on your screen). Captcha-free verified forms submit hands-off. Any job that needs you (captcha / unknown question) is collected, then a Chrome window opens ONLY for those — after the headless pass — so your screen is never taken over during autofill.\n`);

      // ── Phase 1 (HEADLESS, invisible): submit what is hands-off; collect the
      //    jobs that need a human. No window appears.
      const needsHuman: Application[] = [];
      const HUMAN_PHASES = new Set(['auth_required', 'needs_input', 'verify_failed', 'submit_unconfirmed']);
      for (let i = 0; i < queue.length; i++) {
        const app = queue[i]!;
        console.log(`\n[${i + 1}/${queue.length}] ${app.company} — ${app.role}  (id ${app.id})`);
        try {
          const result = await orch.apply(app, approval ? { approval } : {});
          reportApply(app, result);
          if (result.phase === 'submitted') { submitted++; continue; }
          if (HUMAN_PHASES.has(result.phase)) {
            console.log('  ↳ needs you — queued for the visible takeover pass.');
            needsHuman.push(app);
          }
        } catch (err) {
          console.log(`  ⚠️  ERROR — ${(err as Error).message.replace(/\s+/g, ' ').slice(0, 160)}. Skipped (not applied); continuing.`);
        }
      }

      // ── Phase 2 (HEADED): SEQUENTIAL — close the headless browser FIRST, then
      //    open ONE visible window only for the jobs that need you. Never a
      //    concurrent headed+headless Chrome (that closes the takeover page).
      if (needsHuman.length > 0) {
        await browser.close().catch(() => {});
        // Remember what the user is looking at, so the takeover window opens
        // behind it instead of yanking their screen to Chrome mid-fill.
        const prevApp = await frontmostApp();
        const headed = await launchChrome({ headless: false });
        await restoreApp(prevApp); // send focus straight back to the user's work
        log.info(headed.usingChrome ? 'Takeover: your Google Chrome (in background)' : 'Takeover: bundled Chromium (in background)');
        const headedSessions = new PlaywrightApplySessionFactory({
          browser: headed.browser,
          greenhouseJob: (app) => greenhouseProvider.provide(app),
        });
        try {
          for (let i = 0; i < needsHuman.length; i++) {
            const app = needsHuman[i]!;
            console.log(`\n[takeover ${i + 1}/${needsHuman.length}] ${app.company} — ${app.role}  (id ${app.id}, ${app.url})`);
            console.log('  ↳ Filling in the background (no screen switch). You get a banner + the window only when it is ready to submit.');
            try {
              const ok = await attendedTakeover(app, headedSessions, answers, essaySource, store, null, {
                timeoutMs: AUTO_RESUME_TIMEOUT_MS,
                intervalMs: AUTO_RESUME_POLL_MS,
              }, {
                afterOpen: () => restoreApp(prevApp),
                onTouchpoint: (a) => notifier.readyToSubmit(a.company, a.role),
              });
              if (ok) submitted++;
            } catch (err) {
              console.log(`  ⚠️  ERROR — ${(err as Error).message.replace(/\s+/g, ' ').slice(0, 160)}. Skipped; continuing.`);
            }
          }
        } finally {
          await headed.browser.close().catch(() => {});
        }
      }
      console.log(`\n═══ Auto done. Submitted or applied this run: ${submitted}/${queue.length}. ═══\n`);
      return;
    }

    for (let i = 0; i < queue.length; i++) {
      const app = queue[i]!;
      console.log(`\n[${i + 1}/${queue.length}] ${app.company} — ${app.role}  (id ${app.id}, ${app.url})`);

      // Per-job guard: a single job that throws (a flaky page, a browser hiccup)
      // must never kill the batch. Report it and move to the next Ready job — a
      // 24/7 apply loop cannot die on one bad form. Nothing is submitted on a
      // throw (the submit gate is never reached), so no false success is recorded.
      try {
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
      } catch (err) {
        console.log(`  ⚠️  ERROR — ${(err as Error).message.replace(/\s+/g, ' ').slice(0, 160)}. Skipped (not applied); continuing.`);
      }
    }
  } finally {
    // --auto's phase 2 may have already closed the main (headless) browser to
    // launch the headed takeover; closing an already-closed browser is a no-op.
    await browser.close().catch(() => {});
  }

  console.log(`\n═══ Done. Submitted this run: ${submitted}/${queue.length}. ═══\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
