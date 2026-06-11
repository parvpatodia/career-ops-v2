/**
 * Ashby ATS form filler.
 * Ashby is used by ~100 YC/a16z-backed startups.
 *
 * WHY wait for Apply button: Ashby shows a JD page first. The actual form
 * is not present in the DOM until the user clicks Apply. We give the user
 * 5 minutes to click Apply if the form isn't already visible.
 */

import fs from 'fs';
import path from 'path';
import type { ApplyContext, ApplyResult } from './Applier.js';
import { Applier } from './Applier.js';
import { UniversalFormFiller } from './UniversalFormFiller.js';

export class AshbyHandler extends Applier {
  readonly ats = 'ashby';

  protected async fill(context: ApplyContext): Promise<ApplyResult> {
    const identity = this.profile.getIdentity();
    let fieldsFilledCount = 0;
    const fieldsFailed: ApplyResult['fieldsFailed'] = [];
    const screeningQuestions: ApplyResult['screeningQuestions'] = [];
    const p = this.page!;

    // Ashby shows a JD page; form appears after clicking Apply
    const formVisible = await p.locator('input[name="_systemfield_name"]')
      .isVisible({ timeout: 3_000 }).catch(() => false);

    if (!formVisible) {
      console.log('\n  → Click "Apply" in the browser window. Form will auto-fill.');
      const appeared = await p
        .waitForSelector('input[name="_systemfield_name"]', { state: 'visible', timeout: 300_000 })
        .then(() => true)
        .catch(() => false);

      if (!appeared) {
        return this.makeFailResult(context, 'Timed out waiting for Ashby form. Did you click Apply?');
      }
    }

    // ── Standard Ashby fields (name attributes are stable) ────────────────
    const fills: Array<[string, string, string]> = [
      ['input[name="_systemfield_name"]',                 identity.name,    'name'],
      ['input[name="_systemfield_email"]',                identity.email,   'email'],
      ['input[name="_systemfield_phone"]',                identity.phone,   'phone'],
      ['input[placeholder*="LinkedIn"], input[name*="linkedin"]', identity.linkedin, 'linkedin'],
      ['input[placeholder*="GitHub"], input[name*="github"]',     identity.github,   'github'],
      ['input[placeholder*="Website"], input[placeholder*="Portfolio"]',
        identity.portfolio ?? identity.github, 'portfolio'],
    ];

    for (const [selector, value, label] of fills) {
      if (await this.safeType(selector, value)) {
        fieldsFilledCount++;
      } else {
        fieldsFailed.push({ selector, reason: `${label} not filled` });
      }
    }

    // ── Resume upload ─────────────────────────────────────────────────────
    if (context.pdfPath && fs.existsSync(context.pdfPath)) {
      try {
        const fileInput = await p.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(context.pdfPath);
          fieldsFilledCount++;
          this.log.info(`Uploaded resume: ${context.pdfPath}`);
        } else {
          fieldsFailed.push({ selector: 'input[type="file"]', reason: 'file input not found' });
        }
      } catch (err) {
        this.log.warn(`Ashby resume upload failed: ${(err as Error).message}`);
        fieldsFailed.push({ selector: 'input[type="file"]', reason: (err as Error).message });
      }
    }

    // ── Cover letter ──────────────────────────────────────────────────────
    const clPath = context.tailoring.coverLetterPath;
    if (clPath && fs.existsSync(clPath)) {
      const raw = fs.readFileSync(clPath, 'utf8');
      const plain = raw.replace(/^#+ .+$/gm, '').replace(/\*\*/g, '').trim();
      // WHY Locator not ElementHandle: Locator.pressSequentially() is available;
      // ElementHandle<SVGElement|HTMLElement> is not typed for it in TS.
      const textareaLoc = p.locator('textarea[name*="cover"], textarea[placeholder*="cover"]').first();
      if (await textareaLoc.isVisible({ timeout: 2_000 }).catch(() => false)) {
        try {
          await textareaLoc.scrollIntoViewIfNeeded();
          await textareaLoc.click();
          await textareaLoc.selectText().catch(() => p.keyboard.press('Control+a'));
          await p.keyboard.press('Delete');
          await textareaLoc.pressSequentially(plain, { delay: 5 });
          fieldsFilledCount++;
        } catch (err) {
          this.log.warn(`Cover letter fill failed: ${(err as Error).message}`);
          fieldsFailed.push({ selector: 'textarea[cover]', reason: (err as Error).message });
        }
      }
    }

    // ── Custom questions ──────────────────────────────────────────────────
    // WHY .all() + Locator: avoids ElementHandle which lacks pressSequentially.
    const customSections = await p.locator('[data-qa="application-question"]').all();
    for (const section of customSections) {
      const labelEl = section.locator('label, h3, p').first();
      const questionText = ((await labelEl.textContent().catch(() => '')) ?? '').trim();
      if (!questionText) continue;

      const answerObj = this.answers.generate(questionText, {
        company: context.job.company,
        role: context.job.title,
        jd: context.job.jd,
      });

      if (!answerObj) {
        this.log.warn(`No answer for Ashby question: "${questionText.slice(0, 80)}"`);
        screeningQuestions.push({ question: questionText, answer: '[NEEDS MANUAL INPUT]', flagged: true });
        continue;
      }

      const displayAnswer = answerObj.needsReview
        ? `[${answerObj.confidence === 'low' ? 'FLAGGED' : 'NEEDS REVIEW'}] ${answerObj.value}`
        : answerObj.value;

      const inputLoc = section.locator('input[type="text"], textarea').first();
      if (await inputLoc.isVisible({ timeout: 1_000 }).catch(() => false)) {
        try {
          await inputLoc.scrollIntoViewIfNeeded();
          await inputLoc.click();
          await inputLoc.selectText().catch(() => p.keyboard.press('Control+a'));
          await p.keyboard.press('Delete');
          await inputLoc.pressSequentially(answerObj.value, { delay: 20 });
          fieldsFilledCount++;
          screeningQuestions.push({ question: questionText, answer: displayAnswer, flagged: answerObj.needsReview });
        } catch (err) {
          this.log.warn(`Ashby custom field failed for "${questionText.slice(0, 60)}": ${(err as Error).message}`);
          fieldsFailed.push({ selector: 'input/textarea', reason: `"${questionText.slice(0, 60)}"` });
        }
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
      notes: 'Ashby form filled. Review and submit manually.',
    };
  }
}
