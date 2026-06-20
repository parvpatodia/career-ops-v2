/**
 * The thin IO edge of the apply step: turns an Application into a live,
 * ATS-bound fill+verify+submit session for the Orchestrator. Two factories,
 * one shared builder:
 *
 * - PlaywrightApplySessionFactory: production. Resolves the ATS from the
 *   application URL (UrlResolver), checks support (PortalRouter), opens a page,
 *   and binds the verified FormSource. Greenhouse needs its board-api schema, so
 *   a provider supplies it (fetched in prod); without one it ABSTAINS rather
 *   than open a page it cannot fill.
 * - FixtureApplySessionFactory: demo/tests. Same builder, but the ATS + the
 *   navigation URL (a file://) + any Greenhouse board JSON are given explicitly,
 *   so the whole chain runs offline with no real ATS and no network.
 *
 * WHY recorder-less adapters: the Autopilot owns ALL event recording (one layer,
 * LESSONS 2026-06-16). These adapters only fill + read back + verify; the
 * Autopilot's SubmissionRecorder writes fill_verified / abstained / submitted.
 *
 * WHY support is checked BEFORE a page is created: opening a browser for an ATS
 * we have no verified filler for is wasted work and a chance to mis-fill; the
 * abstain must come first (invariant 1).
 */

import type { Browser } from 'playwright';
import { UrlResolver } from '../applier/UrlResolver.js';
import { PortalRouter } from './PortalRouter.js';
import type { PortalKind } from './PortalRouter.js';
import { WorkdayDriver } from '../applier/WorkdayDriver.js';
import { WorkdayFormSource } from '../applier/WorkdayAdapter.js';
import { ApplicationAdapter } from '../applier/ApplicationAdapter.js';
import type { AtsFormSource } from '../applier/ApplicationAdapter.js';
import { GreenhouseFormSource } from '../applier/GreenhouseFormSource.js';
import { GenericFormSource } from '../applier/GenericFormSource.js';
import { bringToFront } from '../applier/browserLaunch.js';
import type { SubmitDriver } from '../applier/Autopilot.js';
import type { Application } from '../types.js';
import type { AnswerSource } from '../applier/IntentPayload.js';
import type { ApplySession, ApplySessionFactory, OpenResult } from './Orchestrator.js';

const DEFAULT_GOTO_TIMEOUT_MS = 30_000;

/**
 * Supplies the Greenhouse boards-api job JSON (questions=true) for an
 * application. Returns null when the schema cannot be obtained (URL unparseable,
 * HTTP error, network down): the factory then abstains rather than open a page
 * it cannot fill safely.
 */
export type GreenhouseJobProvider = (app: Application) => Promise<Record<string, unknown> | null>;

/**
 * Shared session builder. Opens an isolated context+page, navigates, binds the
 * portal's verified FormSource, and returns the session with a close() that
 * tears the page+context down. A navigation failure closes both and rethrows.
 */
async function buildSession(
  browser: Browser,
  navigateUrl: string,
  kind: PortalKind,
  answers: AnswerSource,
  gotoTimeoutMs: number,
  greenhouseJob?: Record<string, unknown>
): Promise<ApplySession> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const close = async (): Promise<void> => {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  };
  // Surface this window to the user on a human touchpoint (captcha/flagged field)
  // so they never have to click the Script-Editor notification to find it.
  const focus = (): Promise<void> => bringToFront(page);
  try {
    await page.goto(navigateUrl, { waitUntil: 'domcontentloaded', timeout: gotoTimeoutMs });
    // The Greenhouse/Lever React forms AND their reCAPTCHA render AFTER
    // domcontentloaded; scanning too early under-detects required questions and
    // the captcha (a racing scan could miss a human touchpoint and over-trust the
    // form). Let the page settle before any source is built/scanned. Capped +
    // catch: analytics-heavy pages may never reach true idle. (file:// fixtures
    // settle instantly, so demos/tests are unaffected.)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    // Construct the portal's source + submit surface; the source is exposed on
    // the session so the attended (partial-fill) flow can drive it directly.
    let source: AtsFormSource;
    let submit: SubmitDriver;
    if (kind === 'workday') {
      const driver = new WorkdayDriver(page); // BOTH the page surface and SubmitDriver
      source = new WorkdayFormSource(driver);
      submit = driver;
    } else if (kind === 'greenhouse') {
      const gh = new GreenhouseFormSource(page, greenhouseJob ?? {});
      source = gh;
      submit = gh;
    } else {
      const generic = new GenericFormSource(page); // DOM-discovered, any ATS
      source = generic;
      submit = generic;
    }
    return { adapter: new ApplicationAdapter(source, answers), submit, source, focus, close };
  } catch (err) {
    await close();
    throw err;
  }
}

export interface PlaywrightFactoryOptions {
  browser: Browser;
  greenhouseJob?: GreenhouseJobProvider;
  router?: PortalRouter;
  urlResolver?: UrlResolver;
  gotoTimeoutMs?: number;
}

export class PlaywrightApplySessionFactory implements ApplySessionFactory {
  private readonly router: PortalRouter;
  private readonly urlResolver: UrlResolver;

  constructor(private readonly opts: PlaywrightFactoryOptions) {
    this.router = opts.router ?? new PortalRouter();
    this.urlResolver = opts.urlResolver ?? new UrlResolver();
  }

  async open(app: Application, answers: AnswerSource): Promise<OpenResult> {
    const resolved = this.urlResolver.resolve(app.url);
    const support = this.router.support(resolved.ats);
    if (!support.supported) return { ok: false, unsupported: true, ats: resolved.ats };

    let kind = support.kind;
    let greenhouseJob: Record<string, unknown> | undefined;
    if (support.kind === 'greenhouse') {
      const fetched = this.opts.greenhouseJob ? await this.opts.greenhouseJob(app) : null;
      if (fetched) {
        greenhouseJob = fetched;
      } else {
        // No board schema (a Greenhouse EMBED on a custom domain, e.g.
        // company.com/careers?gh_jid=..., or a fetch failure): fall back to the
        // vendor-neutral GenericFormSource, which DOM-discovers the rendered form
        // and still verifies-or-abstains. Breadth, not a guess.
        kind = 'generic';
      }
    }

    const session = await buildSession(
      this.opts.browser,
      resolved.url,
      kind,
      answers,
      this.opts.gotoTimeoutMs ?? DEFAULT_GOTO_TIMEOUT_MS,
      greenhouseJob
    );
    return { ok: true, session };
  }
}

export interface FixtureDescriptor {
  kind: PortalKind;
  /** A file:// (or any) URL the page navigates to instead of the real ATS. */
  fileUrl: string;
  /** Greenhouse board JSON fixture (required when kind === 'greenhouse'). */
  greenhouseJob?: Record<string, unknown>;
}

/**
 * Demo/test factory: applies a fixed fixture descriptor to whatever application
 * it is asked to open, so the full pipeline runs offline against a local page.
 * One instance per portal fixture (mirrors demo:autopilot's per-portal loop).
 */
export class FixtureApplySessionFactory implements ApplySessionFactory {
  constructor(
    private readonly browser: Browser,
    private readonly fixture: FixtureDescriptor,
    private readonly gotoTimeoutMs = 10_000
  ) {}

  async open(_app: Application, answers: AnswerSource): Promise<OpenResult> {
    const session = await buildSession(
      this.browser,
      this.fixture.fileUrl,
      this.fixture.kind,
      answers,
      this.gotoTimeoutMs,
      this.fixture.greenhouseJob
    );
    return { ok: true, session };
  }
}
