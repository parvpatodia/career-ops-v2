/**
 * Workday ATS handler.
 *
 * WHY data-automation-id: Workday's React SPA uses stable automation IDs
 * designed for test harnesses — the same IDs we use here. CSS classes are
 * build-hashed and unreliable across Workday tenant versions.
 *
 * WHY auth wall detection: Workday requires account creation or login before
 * the application form is accessible. The previous handler completely ignored
 * this, resulting in 0 fields filled for all 80 Workday applications.
 * We detect the auth wall and prompt the user instead of silently failing.
 *
 * WHY manual EEO: EEO fields (race, gender, disability) are presented as
 * Workday-specific components with complex ARIA trees. We flag them for
 * manual input rather than risk selecting the wrong value.
 */

import fs from 'fs';
import path from 'path';
import type { ApplyContext, ApplyResult } from './Applier.js';
import { Applier } from './Applier.js';
import { UniversalFormFiller } from './UniversalFormFiller.js';

export class WorkdayHandler extends Applier {
  readonly ats = 'workday';

  protected async fill(context: ApplyContext): Promise<ApplyResult> {
    const identity = this.profile.getIdentity();
    let fieldsFilledCount = 0;
    const fieldsFailed: ApplyResult['fieldsFailed'] = [];
    const screeningQuestions: ApplyResult['screeningQuestions'] = [];
    const p = this.page!;

    const wd = (id: string) => `[data-automation-id="${id}"]`;

    await p.waitForTimeout(2_000);

    // ── Auth wall detection ───────────────────────────────────────────────
    // Workday shows a "Sign In" / "Create Account" page before the form.
    // Detect this by looking for the sign-in button or the account creation flow.
    // WHY single joined string: p.locator(selector, options) — second arg is
    // LocatorOptions, not a second selector. All selectors must be comma-joined
    // in the first argument.
    const signInVisible = await p.locator(
      `${wd('signIn')}, button:has-text("Sign In"), a:has-text("Sign In"), ` +
      'button:has-text("Create Account"), input[type="email"][placeholder*="email"]'
    ).first().isVisible({ timeout: 3_000 }).catch(() => false);

    if (signInVisible) {
      const msg =
        'Workday requires account creation or login. ' +
        'Start Chrome with --remote-debugging-port=9271, create/sign into your Workday account ' +
        `for ${context.job.company}, then re-run this job. URL: ${p.url()}`;
      this.log.warn(msg);
      screeningQuestions.push({
        question: 'WORKDAY AUTH REQUIRED',
        answer: `[FLAGGED] ${msg}`,
        flagged: true,
      });
      return {
        jobId: context.job.id,
        ats: this.ats,
        fieldsFilledCount: 0,
        fieldsFailed: [{ selector: 'workday-auth', reason: msg }],
        screeningQuestions,
        stoppedAt: p.url() ?? '',
        readyForSubmit: false,
        notes: msg,
      };
    }

    // ── Click Apply if on job description page ────────────────────────────
    try {
      const applyBtn = p.locator(wd('applyButton')).first();
      if (await applyBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await applyBtn.click({ timeout: 5_000 });
        await p.waitForLoadState('domcontentloaded', { timeout: 15_000 });
        await p.waitForTimeout(2_000);
        this.log.info('Clicked Apply button, navigated to application form');
      }
    } catch (err) {
      this.log.warn(`Apply button click failed: ${(err as Error).message}`);
    }

    // ── Personal info section ─────────────────────────────────────────────
    const fills: Array<[string, string, string]> = [
      [wd('legalNameSection_firstName'), identity.firstName, 'firstName'],
      [wd('legalNameSection_lastName'),  identity.lastName,  'lastName'],
      [wd('email'),                      identity.email,     'email'],
      [wd('phone-number'),               identity.phone,     'phone'],
      ['[data-automation-id*="address"] input, [data-automation-id="addressSection_addressLine1"] input',
        identity.address, 'address'],
    ];

    for (const [selector, value, label] of fills) {
      if (await this.safeType(selector, value)) {
        fieldsFilledCount++;
      } else {
        fieldsFailed.push({ selector, reason: `${label} not filled` });
      }
    }

    // ── Resume upload ─────────────────────────────────────────────────────
    if (context.pdfPath) {
      try {
        const fileInput = await p.$(wd('file-upload-input'));
        if (fileInput) {
          await fileInput.setInputFiles(context.pdfPath);
          fieldsFilledCount++;
          this.log.info(`Uploaded resume: ${context.pdfPath}`);
        } else {
          fieldsFailed.push({ selector: wd('file-upload-input'), reason: 'file input not found' });
        }
      } catch (err) {
        this.log.warn(`Workday resume upload failed: ${(err as Error).message}`);
        fieldsFailed.push({ selector: wd('file-upload-input'), reason: (err as Error).message });
      }
    }

    // ── Education ─────────────────────────────────────────────────────────
    // Workday may auto-parse from resume; only add manually if section is present
    const eduBtn = await p.$(wd('add-education')).catch(() => null);
    if (eduBtn) {
      try {
        await eduBtn.click();
        await p.waitForTimeout(1_000);
        if (await this.safeType(wd('school'), identity.university)) fieldsFilledCount++;
        if (await this.safeType(wd('degree'), "Master's Degree")) fieldsFilledCount++;
        if (await this.safeType(wd('fieldOfStudy'), 'Artificial Intelligence')) fieldsFilledCount++;
      } catch (err) {
        this.log.warn(`Education section fill failed: ${(err as Error).message}`);
      }
    }

    // ── EEO / Voluntary disclosure — always flag for manual review ─────────
    const eeoPresent = await p.$(wd('eeo-section')).catch(() => null);
    if (eeoPresent) {
      screeningQuestions.push({
        question: 'EEO / Voluntary Disclosure (race, gender, disability, veteran)',
        answer: '[FLAGGED] Fill these fields manually — they require careful selection from dropdowns.',
        flagged: true,
      });
    }

    // ── Sponsorship question ──────────────────────────────────────────────
    const sponsorEl = await p.$(
      '[data-automation-id*="sponsor"], [data-automation-id*="visa"]'
    ).catch(() => null);

    if (sponsorEl) {
      const workAuth = this.profile.getWorkAuth();
      screeningQuestions.push({
        question: 'Visa / Sponsorship',
        answer: `[NEEDS REVIEW] ${workAuth.sponsorshipAnswer}`,
        flagged: true,
      });
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
      readyForSubmit: fieldsFilledCount > 0,
      notes: 'Workday: review EEO fields and sponsorship before submitting.',
    };
  }
}
