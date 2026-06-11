/**
 * Abstract base applier — owns the browser lifecycle and shared fill utilities.
 *
 * Browser session strategy (in priority order):
 * 1. CDP reconnect: if a Chrome/Chromium is already running with
 *    --remote-debugging-port=9271, reuse it (and its cookies).
 * 2. Persistent profile: launch Playwright Chromium using .browser-profile/
 *    as the user-data directory. Cookies and localStorage are written to disk
 *    on every page and survive process restarts. Log in once per platform;
 *    every subsequent run loads the session automatically.
 *
 * WHY persistent profile over a fresh context: a fresh context has no cookies,
 * so every Handshake/LinkedIn/Workday job requires a new login. The persistent
 * profile stores session tokens exactly as a normal browser would, making the
 * login requirement a one-time setup step per platform, not per session.
 */

import type { Page, Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import type { Job, TailoringResult } from '../types.js';
import { Logger } from '../utils/Logger.js';
import { ProfileLoader } from './ProfileLoader.js';
import { AnswerGenerator } from './AnswerGenerator.js';
import { launchStealthContext, CDP_PORT, PROFILE_DIR } from './BrowserSession.js';

export interface ApplyContext {
  job: Job;
  tailoring: TailoringResult;
  pdfPath?: string;
}

export interface ApplyResult {
  jobId: string;
  ats: string;
  fieldsFilledCount: number;
  fieldsFailed: Array<{ selector: string; reason: string }>;
  screeningQuestions: Array<{ question: string; answer: string; flagged: boolean }>;
  stoppedAt: string;
  readyForSubmit: boolean;
  notes: string;
  closed?: boolean;
}

const CDP_URL = `http://localhost:${CDP_PORT}`;

export abstract class Applier {
  abstract readonly ats: string;

  protected log: Logger;
  protected profile: ProfileLoader;
  protected answers: AnswerGenerator;

  // browser is only set when session came from CDP (connected to existing Chrome).
  // browserCtx is always set during fillAndStop — it is the live BrowserContext.
  protected browser: Browser | null = null;
  protected browserCtx: BrowserContext | null = null;
  protected page: Page | null = null;

  constructor(profilePath = 'config/profile.yml') {
    this.log = new Logger(this.constructor.name);
    this.profile = new ProfileLoader(profilePath);
    this.answers = new AnswerGenerator(this.profile);
  }

  // ── Static ATS detection ─────────────────────────────────────────────────

  static detect(url: string): 'greenhouse' | 'lever' | 'workday' | 'linkedin' | 'ashby' | 'handshake' | 'generic' {
    if (url.includes('greenhouse.io') || url.includes('boards.greenhouse') ||
        url.includes('gh_jid=') || url.includes('gh_src=')) return 'greenhouse';
    if (url.includes('lever.co/')) return 'lever';
    if (url.includes('myworkdayjobs.com') || url.includes('myworkdaysite.com')) return 'workday';
    if (url.includes('linkedin.com/jobs')) return 'linkedin';
    if (url.includes('ashbyhq.com')) return 'ashby';
    if (url.includes('joinhandshake.com')) return 'handshake';
    return 'generic';
  }

  // ── Public entry point ───────────────────────────────────────────────────

  async fillAndStop(context: ApplyContext): Promise<ApplyResult> {
    const { ctx, browser } = await this.openSession();
    this.browser    = browser;
    this.browserCtx = ctx;

    // Close any leftover pages from the previous job so we start clean.
    for (const pg of ctx.pages()) await pg.close().catch(() => {});
    this.page = await ctx.newPage();

    try {
      const targetUrl = context.job.applyUrl ?? context.job.url;
      this.log.info(`Navigating to ${targetUrl}`);
      await this.page.goto(targetUrl, { timeout: 30_000, waitUntil: 'domcontentloaded' });
    } catch (err) {
      this.log.warn(`Navigation failed: ${(err as Error).message}`);
    }

    // Detect closed/expired postings before attempting to fill.
    const targetUrl = context.job.applyUrl ?? context.job.url;
    const closedReason = await this.detectClosedPosting(targetUrl);
    if (closedReason) {
      this.log.info(`Posting closed — skipping: ${closedReason}`);
      return { ...this.makeFailResult(context, closedReason), closed: true };
    }

    const result = await this.fill(context);

    this.log.info(`[${this.ats.toUpperCase()}] ${context.job.company} — ${context.job.title}`, {
      filled: result.fieldsFilledCount,
      failed: result.fieldsFailed.length,
      flagged: result.screeningQuestions.filter((q) => q.flagged).length,
    });

    console.log('\n══════════ READY FOR REVIEW ══════════');
    console.log(`  Company : ${context.job.company}`);
    console.log(`  Role    : ${context.job.title}`);
    console.log(`  ATS     : ${result.ats.toUpperCase()}`);
    console.log(`  Filled  : ${result.fieldsFilledCount}`);
    if (result.fieldsFailed.length > 0) {
      console.log(`  MISSED  : ${result.fieldsFailed.length} field(s) — check log for selectors`);
      for (const f of result.fieldsFailed) {
        console.log(`    • ${f.selector}  →  ${f.reason}`);
      }
    }
    if (result.screeningQuestions.some((q) => q.flagged)) {
      console.log('\n  ⚠  FLAGGED QUESTIONS (review before submitting):');
      for (const q of result.screeningQuestions.filter((q) => q.flagged)) {
        console.log(`    Q: ${q.question}`);
        console.log(`    A: ${q.answer}`);
        if (q.answer.startsWith('[FLAGGED]') || q.answer.startsWith('[NEEDS REVIEW]')) {
          console.log(`    ^ VERIFY THIS ANSWER`);
        }
      }
    }
    console.log('\n  STOP: review the form, then click Submit manually.');
    console.log('══════════════════════════════════════\n');

    return result;
  }

  // ── Delegation support for HandshakeHandler ──────────────────────────────

  // WHY: HandshakeHandler shares its live BrowserContext with the sub-handler
  // (Greenhouse/Lever/etc.) so both operate in the same window — no second
  // browser launch, no lost session cookies.
  setPageContext(browser: Browser | null, page: Page, ctx?: BrowserContext): void {
    this.browser    = browser;
    this.browserCtx = ctx ?? null;
    this.page       = page;
  }

  // ── Abstract ─────────────────────────────────────────────────────────────

  protected abstract fill(context: ApplyContext): Promise<ApplyResult>;

  // WHY public: fill() is protected; this thin wrapper lets HandshakeHandler
  // call fill() on a delegated sub-handler instance.
  async fillOnExistingPage(context: ApplyContext): Promise<ApplyResult> {
    return this.fill(context);
  }

  // ── Shared utilities ─────────────────────────────────────────────────────

  /**
   * Type text into a field using pressSequentially (keydown/keyup chain).
   * WHY pressSequentially instead of fill(): React-controlled inputs listen
   * to keyboard events. fill() fires only an InputEvent and leaves the React
   * state model unupdated, so the field appears filled but is empty on submit.
   */
  protected async safeType(selector: string, value: string, timeout = 4_000): Promise<boolean> {
    try {
      const loc = this.page!.locator(selector).first();
      await loc.scrollIntoViewIfNeeded({ timeout });
      await loc.click({ timeout });
      await loc.selectText().catch(() => this.page!.keyboard.press('Control+a'));
      await this.page!.keyboard.press('Delete');
      await loc.pressSequentially(value, { delay: 30 });
      return true;
    } catch (err) {
      this.log.warn(`safeType failed [${selector}]: ${(err as Error).message}`);
      return false;
    }
  }

  protected async safeSelect(selector: string, value: string, timeout = 3_000): Promise<boolean> {
    try {
      const loc = this.page!.locator(selector).first();
      await loc.scrollIntoViewIfNeeded({ timeout });
      try {
        await loc.selectOption({ label: value }, { timeout });
        return true;
      } catch {
        await loc.selectOption({ value }, { timeout });
        return true;
      }
    } catch (err) {
      this.log.warn(`safeSelect failed [${selector}] value="${value}": ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Opens the platform login page and waits (up to 2 min) for the user to
   * complete login in the already-visible browser window.
   * After login the session is saved automatically to .browser-profile/ and
   * will not require login again on future runs.
   */
  protected async waitForLogin(
    loginUrl: string,
    isLoggedIn: (url: URL) => boolean,
    timeoutMs = 120_000,
  ): Promise<void> {
    console.log('\n  ⚠  Login required — browser is open and waiting.');
    console.log('     Log in now and the form will fill automatically.');
    console.log('     Your session will be saved — you will not be asked again. (2 min timeout)\n');
    await this.page!.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
    await this.page!.waitForURL(isLoggedIn, { timeout: timeoutMs });
    this.log.info('Login detected — session saved to .browser-profile/');
  }

  // Checks the loaded page for 404 / closed-posting signals before filling.
  // Returns a human-readable reason string if closed, null if the job is live.
  private async detectClosedPosting(expectedUrl?: string): Promise<string | null> {
    if (!this.page) return null;

    const url   = this.page.url().toLowerCase();
    const title = (await this.page.title().catch(() => '')).toLowerCase();

    // Silent redirect: navigated to a completely different domain or path.
    // Excludes auth redirects (handled separately per handler).
    if (expectedUrl) {
      try {
        const exp = new URL(expectedUrl);
        const got = new URL(this.page.url());
        if (exp.hostname !== got.hostname) {
          return `Redirected to different domain: ${got.hostname}`;
        }
      } catch { /* malformed URL, skip check */ }
    }

    const closedTitlePatterns = ['404', 'not found', 'page not found', 'does not exist'];
    const closedUrlPatterns   = ['/404', 'error=404', '/not-found', '/job-not-found'];
    const closedBodyPhrases   = [
      'no longer available', 'no longer accepting applications',
      'position is closed', 'job is closed', 'application closed',
      'this posting has been closed', 'this job has been filled',
      'does not exist', 'position has been filled',
      'this role is no longer', 'this position is no longer',
      'this listing has expired', 'job listing not found',
    ];

    if (closedTitlePatterns.some((p) => title.includes(p))) return `Page title indicates 404: "${title}"`;
    if (closedUrlPatterns.some((p) => url.includes(p)))     return `URL indicates 404: ${url}`;

    try {
      const body = (
        await this.page.locator('body').textContent({ timeout: 2_000 }).catch(() => '')
      )?.toLowerCase() ?? '';
      const match = closedBodyPhrases.find((p) => body.includes(p));
      if (match) return `Posting closed — page says: "${match}"`;
    } catch { /* page may not have a body yet */ }

    return null;
  }

  protected makeFailResult(context: ApplyContext, reason: string): ApplyResult {
    return {
      jobId: context.job.id,
      ats: this.ats,
      fieldsFilledCount: 0,
      fieldsFailed: [{ selector: 'n/a', reason }],
      screeningQuestions: [],
      stoppedAt: this.page?.url() ?? '',
      readyForSubmit: false,
      notes: reason,
    };
  }

  // ── Browser session lifecycle ─────────────────────────────────────────────

  private async openSession(): Promise<{ ctx: BrowserContext; browser: Browser | null }> {
    // Priority 1: reuse an existing Chrome/Chromium already running with the
    // debug port open (e.g. the user launched Chrome manually or a prior
    // apply session is still open).
    try {
      const b = await chromium.connectOverCDP(CDP_URL, { timeout: 3_000 });
      this.log.info('Reusing existing Chrome session (CDP)');
      const ctx = b.contexts()[0] ?? await b.newContext();
      return { ctx, browser: b };
    } catch { /* no debug Chrome running */ }

    // Priority 2: stealth persistent profile — real Chrome if available,
    // bundled Chromium with automation flags stripped if not.
    // Sessions survive process restarts; login is a one-time step per platform.
    this.log.info(`Launching stealth browser session (${PROFILE_DIR})`);
    const { ctx, usingChrome } = await launchStealthContext();
    this.log.info(usingChrome ? 'Using system Google Chrome' : 'Using bundled Chromium (Chrome not found)');
    return { ctx, browser: null };
  }
}
