/**
 * Handshake ATS handler.
 *
 * Two-phase design:
 * 1. RESOLVE: The scanner saves job-search page URLs. We convert those to
 *    posting URLs (stu/postings/{id}) before navigation. This happens in
 *    index.ts via UrlResolver, so by the time fill() runs we are already
 *    on the posting page.
 *
 * 2. DELEGATE: Handshake posting pages either:
 *    a) Link to an external ATS (Greenhouse/Lever/Ashby/Workday). We detect
 *       the external link, navigate to it, and delegate to the correct handler
 *       by sharing the existing browser + page instance via setPageContext().
 *    b) Have a Handshake-native Quick Apply form. We fill it inline.
 *
 * WHY setPageContext delegation instead of new browser: Launching a second
 * browser for the external ATS is wasteful and loses any session state
 * (e.g. login cookies). Sharing the existing page keeps everything in one
 * window.
 *
 * WHY external ATS detection before Quick Apply: Quick Apply on Handshake is
 * a stripped form with no cover letter or custom questions. External ATS forms
 * are richer and match company expectations. Always prefer external if present.
 */

import fs from 'fs';
import path from 'path';
import type { ApplyContext, ApplyResult } from './Applier.js';
import { Applier } from './Applier.js';
import { GreenhouseHandler } from './GreenhouseHandler.js';
import { LeverHandler } from './LeverHandler.js';
import { AshbyHandler } from './AshbyHandler.js';
import { WorkdayHandler } from './WorkdayHandler.js';
import { GenericHandler } from './GenericHandler.js';
import { UniversalFormFiller } from './UniversalFormFiller.js';

// External apply URL patterns visible on Handshake posting pages
const EXTERNAL_ATS_SELECTORS = [
  'a[href*="greenhouse.io"]',
  'a[href*="lever.co"]',
  'a[href*="ashbyhq.com"]',
  'a[href*="myworkdayjobs.com"]',
  'a[href*="myworkdaysite.com"]',
  'a[href*="gh_jid="]',
  'a[data-hook*="external"]',
  'a[aria-label*="Apply Externally"]',
  'a:has-text("Apply Externally")',
  'a:has-text("Apply on Company Site")',
  'a:has-text("Apply Now")',
  'button:has-text("Apply Externally")',
];

export class HandshakeHandler extends Applier {
  readonly ats = 'handshake';

  protected async fill(context: ApplyContext): Promise<ApplyResult> {
    const p = this.page!;

    await p.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});

    // ── Redirect / closed check ───────────────────────────────────────────
    // Handshake silently redirects expired postings to /explore or /jobs
    // instead of showing a 404. detectClosedPosting() in the base class only
    // checks for "does not exist" text, which the Explore page doesn't have.
    const url = p.url();
    const onPosting = url.includes('/stu/postings/') || url.includes('/postings/');
    if (!onPosting && !url.includes('/login') && !url.includes('/users/sign')) {
      return { ...this.makeFailResult(context, `Posting unavailable — Handshake redirected to ${url}`), closed: true };
    }
    if (url.includes('/login') || url.includes('/sign-in') || url.includes('/users/sign')) {
      const postingUrl = context.job.applyUrl ?? context.job.url;
      try {
        await this.waitForLogin(
          'https://app.joinhandshake.com/users/sign_in',
          (u) => u.href.includes('joinhandshake.com') &&
                 !u.href.includes('/sign_in') &&
                 !u.href.includes('/login') &&
                 !u.href.includes('/users/sign'),
        );
        await p.goto(postingUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await p.waitForTimeout(2_000);
      } catch {
        return this.makeFailResult(context, 'Handshake login timeout — please log in and re-run.');
      }
    }

    // ── Detect external apply link ────────────────────────────────────────
    const externalUrl = await this.findExternalApplyUrl();
    if (externalUrl) {
      this.log.info(`Handshake → external ATS: ${externalUrl}`);
      try {
        await p.goto(externalUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await p.waitForTimeout(2_000);
      } catch (err) {
        this.log.warn(`Navigate to external ATS failed: ${(err as Error).message}`);
        return this.makeFailResult(context, `External ATS navigation failed: ${(err as Error).message}`);
      }

      // Delegate to the correct ATS handler using the final URL
      const finalUrl = p.url();
      return this.delegateFill(finalUrl, context);
    }

    // ── Click Quick Apply / Apply Now ─────────────────────────────────────
    const quickApplyBtn = p.locator([
      'button:has-text("Quick Apply")',
      'a:has-text("Quick Apply")',
      'button[data-hook*="apply"]',
      'a[data-hook*="apply"]',
    ].join(', ')).first();

    if (await quickApplyBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await quickApplyBtn.click().catch(() => {});
      await p.waitForTimeout(2_000);
      this.log.info('Opened Handshake Quick Apply form');
    }

    // ── Fill Handshake-native form ────────────────────────────────────────
    // Handshake native form uses standard input fields similar to Greenhouse
    return this.fillNativeForm(context);
  }

  private async findExternalApplyUrl(): Promise<string | null> {
    const p = this.page!;
    for (const sel of EXTERNAL_ATS_SELECTORS) {
      try {
        const loc = p.locator(sel).first();
        if (!(await loc.isVisible({ timeout: 1_000 }).catch(() => false))) continue;

        const href = await loc.getAttribute('href').catch(() => null);
        if (href && href.startsWith('http')) return href;

        // Some Handshake links open in a new tab — intercept the popup
        const [popup] = await Promise.all([
          p.context().waitForEvent('page', { timeout: 3_000 }).catch(() => null),
          loc.click({ timeout: 2_000 }).catch(() => {}),
        ]);
        if (popup) {
          const popupUrl = popup.url();
          await popup.close().catch(() => {});
          if (popupUrl && !popupUrl.includes('joinhandshake.com')) return popupUrl;
        }
      } catch { /* selector didn't match — try next */ }
    }
    return null;
  }

  private async delegateFill(finalUrl: string, context: ApplyContext): Promise<ApplyResult> {
    const ats = Applier.detect(finalUrl);
    this.log.info(`Delegating to ${ats.toUpperCase()} handler`);

    let handler: Applier;
    switch (ats) {
      case 'greenhouse': handler = new GreenhouseHandler(); break;
      case 'lever':      handler = new LeverHandler();      break;
      case 'ashby':      handler = new AshbyHandler();      break;
      case 'workday':    handler = new WorkdayHandler();    break;
      default:           handler = new GenericHandler();    break;
    }

    // Share the existing BrowserContext so the sub-handler reuses cookies
    // and does not launch a second window.
    handler.setPageContext(this.browser, this.page!, this.browserCtx ?? undefined);
    return handler.fillOnExistingPage(context);
  }

  private async fillNativeForm(context: ApplyContext): Promise<ApplyResult> {
    const identity = this.profile.getIdentity();
    const p = this.page!;
    let fieldsFilledCount = 0;
    const fieldsFailed: ApplyResult['fieldsFailed'] = [];
    const screeningQuestions: ApplyResult['screeningQuestions'] = [];

    // Handshake native form uses standard HTML fields
    const fills: Array<[string, string, string]> = [
      ['input[name="first_name"], input[placeholder*="First"]', identity.firstName, 'first_name'],
      ['input[name="last_name"], input[placeholder*="Last"]',   identity.lastName,  'last_name'],
      ['input[name="email"], input[type="email"]',              identity.email,     'email'],
      ['input[name="phone"], input[type="tel"]',                identity.phone,     'phone'],
    ];

    for (const [selector, value, label] of fills) {
      if (await this.safeType(selector, value)) {
        fieldsFilledCount++;
      } else {
        fieldsFailed.push({ selector, reason: `${label} not filled` });
      }
    }

    // Resume upload
    if (context.pdfPath) {
      try {
        const fileInput = await p.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(context.pdfPath);
          fieldsFilledCount++;
        }
      } catch (err) {
        fieldsFailed.push({ selector: 'input[type="file"]', reason: (err as Error).message });
      }
    }

    // ── Cover letter PDF upload ───────────────────────────────────────────
    const clVariant = context.tailoring.resumeVariant;
    const clPdfPath = clVariant === 'robotics'
      ? path.resolve('cv/cover_letter_robotics.pdf')
      : path.resolve('cv/cover_letter_ai.pdf');

    if (fs.existsSync(clPdfPath)) {
      try {
        const coverInput = await p.$(
          'input[type="file"][name*="cover"], input[type="file"][id*="cover"], ' +
          'input[type="file"][aria-label*="cover"], input[type="file"][aria-label*="Cover"]'
        );
        if (coverInput) {
          await coverInput.setInputFiles(clPdfPath);
          fieldsFilledCount++;
          this.log.info(`Uploaded cover letter PDF: ${clPdfPath}`);
        }
      } catch (err) {
        this.log.warn(`Cover letter PDF upload failed: ${(err as Error).message}`);
      }
    }

    // ── UniversalFormFiller sweep (belt-and-suspenders) ───────────────────
    try {
      const uff = new UniversalFormFiller();
      const uffResult = await uff.fill(p, this.profile);
      fieldsFilledCount += uffResult.filled;
      if (uffResult.filled > 0) {
        this.log.info(`UFF sweep: filled ${uffResult.filled} additional field(s)`);
      }
    } catch (err) {
      this.log.warn(`UFF sweep failed: ${(err as Error).message}`);
    }

    return {
      jobId: context.job.id,
      ats: this.ats,
      fieldsFilledCount,
      fieldsFailed,
      screeningQuestions,
      stoppedAt: p.url() ?? '',
      readyForSubmit: true,
      notes: 'Handshake native form filled. Review and submit manually.',
    };
  }
}
