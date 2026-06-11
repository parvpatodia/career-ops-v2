/**
 * LinkedIn Easy Apply handler.
 *
 * WHY pressSequentially: Same reason as Greenhouse — LinkedIn's React modal
 * ignores fill(). The previous handler used fill() for name and phone fields,
 * causing them to appear filled visually but empty on submit.
 *
 * WHY login check: LinkedIn Easy Apply requires the user to be logged in.
 * The CDP reconnect in Applier reuses the user's existing browser session
 * (which may or may not have LinkedIn cookies). If not logged in, we detect
 * the login wall immediately and bail with a clear message instead of
 * silently filling 0 fields.
 *
 * WHY MAX_STEPS = 15: LinkedIn Easy Apply typically has 3-5 steps, but
 * some roles add extra screening steps (work authorization, assessment, etc.).
 * 15 is a conservative upper bound to prevent infinite loops.
 */

import fs from 'fs';
import path from 'path';
import type { ApplyContext, ApplyResult } from './Applier.js';
import { Applier } from './Applier.js';
import { UniversalFormFiller } from './UniversalFormFiller.js';

export class EasyApplyHandler extends Applier {
  readonly ats = 'linkedin';

  protected async fill(context: ApplyContext): Promise<ApplyResult> {
    const identity = this.profile.getIdentity();
    const p = this.page!;
    let fieldsFilledCount = 0;
    const fieldsFailed: ApplyResult['fieldsFailed'] = [];
    const screeningQuestions: ApplyResult['screeningQuestions'] = [];

    // ── Login check ───────────────────────────────────────────────────────
    // LinkedIn redirects to /login or /checkpoint when not authenticated.
    const currentUrl = p.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') ||
        currentUrl.includes('/authwall') || currentUrl.includes('/signup')) {
      const postingUrl = context.job.applyUrl ?? context.job.url;
      try {
        await this.waitForLogin(
          'https://www.linkedin.com/login',
          (u) => u.href.includes('linkedin.com') &&
                 !u.href.includes('/login') &&
                 !u.href.includes('/checkpoint') &&
                 !u.href.includes('/authwall') &&
                 !u.href.includes('/signup'),
        );
        await p.goto(postingUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await p.waitForTimeout(2_000);
      } catch {
        return this.makeFailResult(context, 'LinkedIn login timeout — please log in and re-run.');
      }
    }

    // ── Click Easy Apply button ───────────────────────────────────────────
    try {
      const applyBtn = p.locator(
        '.jobs-apply-button, button[aria-label*="Easy Apply"], button[aria-label*="easy apply"]'
      ).first();
      if (await applyBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await applyBtn.click({ timeout: 5_000 });
        await p.waitForSelector('.jobs-easy-apply-modal, [data-test-modal-id]', { timeout: 10_000 });
        this.log.info('Easy Apply modal opened');
      } else {
        this.log.warn('Easy Apply button not found — may be an external apply job');
        return this.makeFailResult(context, 'Easy Apply button not found on this job page');
      }
    } catch (err) {
      this.log.warn(`Could not open Easy Apply modal: ${(err as Error).message}`);
      return this.makeFailResult(context, `Modal open failed: ${(err as Error).message}`);
    }

    // ── Upload resume in first step ───────────────────────────────────────
    if (context.pdfPath && fs.existsSync(context.pdfPath)) {
      try {
        const fileInput = p.locator('input[type="file"]').first();
        if (await fileInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await fileInput.setInputFiles(context.pdfPath);
          fieldsFilledCount++;
          this.log.info(`Uploaded resume: ${context.pdfPath}`);
        }
      } catch (err) {
        this.log.warn(`Resume upload failed: ${(err as Error).message}`);
        fieldsFailed.push({ selector: 'input[type="file"]', reason: 'resume upload failed' });
      }
    }

    // ── Step loop ─────────────────────────────────────────────────────────
    let stepCount = 0;
    const MAX_STEPS = 15;

    while (stepCount < MAX_STEPS) {
      stepCount++;
      await p.waitForTimeout(800);

      // Stop at review/submit step — never submit automatically
      const isReview = await p.locator(
        '[aria-label="Review your application"], .jobs-easy-apply-review, ' +
        'button[aria-label="Submit application"], button[aria-label*="submit"]'
      ).first().isVisible({ timeout: 1_000 }).catch(() => false);
      if (isReview) {
        this.log.info(`Reached review step after ${stepCount} step(s). Stopping.`);
        break;
      }

      // Modal gone (may have been closed externally)
      const modalGone = !(await p.locator('.jobs-easy-apply-modal, [data-test-modal-id]')
        .first().isVisible({ timeout: 500 }).catch(() => true));
      if (modalGone) {
        this.log.warn('Easy Apply modal closed unexpectedly');
        break;
      }

      // ── Fill fields in current step ─────────────────────────────────────

      // Name fields (modal sometimes shows these even if profile is complete)
      // WHY Locator.all() throughout: avoids ElementHandle<SVGElement|HTMLElement>
      // which lacks pressSequentially in TypeScript types.
      const nameFields = await p.locator('input[id*="name"], input[placeholder*="irst"], input[placeholder*="ast"]').all();
      for (const field of nameFields) {
        const placeholder = ((await field.getAttribute('placeholder')) ?? '').toLowerCase();
        const id = ((await field.getAttribute('id')) ?? '').toLowerCase();
        const hint = `${placeholder} ${id}`;
        let value = '';
        if (/first|given/.test(hint)) value = identity.firstName;
        else if (/last|family|surname/.test(hint)) value = identity.lastName;
        if (value) {
          try {
            await field.scrollIntoViewIfNeeded();
            await field.click();
            await field.selectText().catch(() => p.keyboard.press('Control+a'));
            await p.keyboard.press('Delete');
            await field.pressSequentially(value, { delay: 30 });
            fieldsFilledCount++;
          } catch (err) {
            this.log.warn(`Name field failed [${id || placeholder}]: ${(err as Error).message}`);
          }
        }
      }

      // Phone field — Locator to get pressSequentially
      const phoneLoc = p.locator('input[id*="phone"], input[type="tel"]').first();
      if (await phoneLoc.isVisible({ timeout: 1_500 }).catch(() => false)) {
        try {
          const currentVal = await phoneLoc.inputValue().catch(() => '');
          if (!currentVal.trim()) {
            await phoneLoc.scrollIntoViewIfNeeded();
            await phoneLoc.click();
            await phoneLoc.selectText().catch(() => p.keyboard.press('Control+a'));
            await p.keyboard.press('Delete');
            await phoneLoc.pressSequentially(identity.phone, { delay: 30 });
            fieldsFilledCount++;
          }
        } catch (err) {
          this.log.warn(`Phone field failed: ${(err as Error).message}`);
        }
      }

      // Screening questions on this step — Locator.all() avoids ElementHandle
      const questionElements = await p.locator('.jobs-easy-apply-form-element').all();
      for (const qEl of questionElements) {
        const labelText = await qEl.locator('label, legend').first().textContent().catch(() => '').then((t) => t?.trim() ?? '');
        if (!labelText) continue;

        const answerObj = this.answers.generate(labelText, {
          company: context.job.company,
          role: context.job.title,
          jd: context.job.jd,
        });

        if (!answerObj) {
          this.log.warn(`No answer for: "${labelText.slice(0, 80)}" — needs manual input`);
          screeningQuestions.push({ question: labelText, answer: '[NEEDS MANUAL INPUT]', flagged: true });
          continue;
        }

        const displayAnswer = answerObj.needsReview
          ? `[${answerObj.confidence === 'low' ? 'FLAGGED' : 'NEEDS REVIEW'}] ${answerObj.value}`
          : answerObj.value;

        // Radio button — qEl is a Locator so use .locator().all(), not .$$()
        const radioLoc = qEl.locator('input[type="radio"]').first();
        const hasRadio = await radioLoc.isVisible({ timeout: 500 }).catch(() => false);
        if (hasRadio) {
          const radios = await qEl.locator('input[type="radio"]').all();
          for (const r of radios) {
            const rLabel = await r.evaluate((el: Element) => {
              const input = el as HTMLInputElement;
              const lbl = document.querySelector<HTMLElement>(`label[for="${input.id}"]`);
              return lbl?.textContent?.trim() ?? '';
            }).catch(() => '');
            if (rLabel.toLowerCase().includes(answerObj.value.toLowerCase())) {
              await r.click().catch(() => {});
              fieldsFilledCount++;
              screeningQuestions.push({ question: labelText, answer: displayAnswer, flagged: answerObj.needsReview });
              break;
            }
          }
          continue;
        }

        // Select dropdown
        const selectLoc = qEl.locator('select').first();
        if (await selectLoc.isVisible({ timeout: 500 }).catch(() => false)) {
          try {
            await selectLoc.selectOption({ label: answerObj.value });
            fieldsFilledCount++;
            screeningQuestions.push({ question: labelText, answer: displayAnswer, flagged: answerObj.needsReview });
          } catch {
            try {
              await selectLoc.selectOption({ value: answerObj.value });
              fieldsFilledCount++;
            } catch (err) {
              this.log.warn(`Select failed for "${labelText.slice(0, 60)}": ${(err as Error).message}`);
              fieldsFailed.push({ selector: 'select', reason: `"${labelText.slice(0, 60)}"` });
            }
          }
          continue;
        }

        // Text input or textarea
        const inputLoc = qEl.locator('input[type="text"], input[type="number"], textarea').first();
        if (await inputLoc.isVisible({ timeout: 500 }).catch(() => false)) {
          try {
            await inputLoc.scrollIntoViewIfNeeded();
            await inputLoc.click();
            await inputLoc.selectText().catch(() => p.keyboard.press('Control+a'));
            await p.keyboard.press('Delete');
            await inputLoc.pressSequentially(answerObj.value, { delay: 20 });
            fieldsFilledCount++;
            screeningQuestions.push({ question: labelText, answer: displayAnswer, flagged: answerObj.needsReview });
          } catch (err) {
            this.log.warn(`Text field failed for "${labelText.slice(0, 60)}": ${(err as Error).message}`);
            fieldsFailed.push({ selector: 'input/textarea', reason: `"${labelText.slice(0, 60)}"` });
          }
        }
      }

      // ── Advance to next step ────────────────────────────────────────────
      const nextBtn = p.locator(
        'button[aria-label="Continue to next step"], button[aria-label*="Next step"], ' +
        'button[aria-label*="next step"], footer button[type="submit"]:not([aria-label*="submit"])'
      ).first();

      if (!(await nextBtn.isVisible({ timeout: 1_500 }).catch(() => false))) {
        this.log.info('No "Next" button found — reached end of steps');
        break;
      }
      await nextBtn.click();
      this.log.info(`Advanced to step ${stepCount + 1}`);
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
      notes: `Stopped at review step after ${stepCount} step(s). Click "Submit application" after reviewing.`,
    };
  }
}
