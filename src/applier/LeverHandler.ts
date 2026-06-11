/**
 * Lever ATS form filler.
 *
 * WHY pressSequentially everywhere: Lever's React form state doesn't
 * update on fill(). Previously this handler used fill() for all fields —
 * that was the direct cause of empty fields on Lever submissions.
 *
 * WHY URL normalization removed: The old code did `https://${identity.linkedin}`.
 * If profile.yml stored "https://linkedin.com/in/..." the result was
 * "https://https://linkedin.com/..." which fails URL validation. ProfileLoader
 * now normalizes URLs at load time — handlers just use identity.linkedin directly.
 */

import fs from 'fs';
import path from 'path';
import type { ApplyContext, ApplyResult } from './Applier.js';
import { Applier } from './Applier.js';
import { UniversalFormFiller } from './UniversalFormFiller.js';

export class LeverHandler extends Applier {
  readonly ats = 'lever';

  protected async fill(context: ApplyContext): Promise<ApplyResult> {
    const identity = this.profile.getIdentity();
    let fieldsFilledCount = 0;
    const fieldsFailed: ApplyResult['fieldsFailed'] = [];
    const screeningQuestions: ApplyResult['screeningQuestions'] = [];
    const p = this.page!;

    // Lever's application form renders below the job description.
    // Wait for the name field — if it doesn't appear, the form structure changed.
    const formFound = await p.waitForSelector('input[name="name"]', { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!formFound) {
      this.log.warn('Lever form not found within 15 s — page may require login or has changed');
      fieldsFailed.push({ selector: 'input[name="name"]', reason: 'form not found within 15s' });
      // Don't bail: still try to fill what's there
    }

    // ── Standard Lever fields ─────────────────────────────────────────────
    // WHY identity.linkedin directly: ProfileLoader.normalizeUrl() already
    // prepended https:// — no additional prefix needed here.
    const fills: Array<[string, string, string]> = [
      ['input[name="name"]',            identity.name,    'name'],
      ['input[name="email"]',           identity.email,   'email'],
      ['input[name="phone"]',           identity.phone,   'phone'],
      ['input[name="org"]',             'Northeastern University', 'org'],
      ['input[name="urls[LinkedIn]"]',  identity.linkedin,  'linkedin'],
      ['input[name="urls[GitHub]"]',    identity.github,    'github'],
      ['input[name="urls[Portfolio]"]', identity.portfolio ?? identity.github, 'portfolio'],
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
        this.log.warn(`Resume upload failed: ${(err as Error).message}`);
        fieldsFailed.push({ selector: 'input[type="file"]', reason: (err as Error).message });
      }
    }

    // ── Cover letter (textarea) ───────────────────────────────────────────
    // Lever always has a comments/cover letter textarea.
    const clPath = context.tailoring.coverLetterPath;
    if (clPath && fs.existsSync(clPath)) {
      const raw = fs.readFileSync(clPath, 'utf8');
      const plain = raw.replace(/^#+ .+$/gm, '').replace(/\*\*/g, '').trim();
      if (await this.safeType('textarea[name="comments"]', plain)) {
        fieldsFilledCount++;
      } else {
        fieldsFailed.push({ selector: 'textarea[name="comments"]', reason: 'cover letter not filled' });
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

    // ── Custom questions ──────────────────────────────────────────────────
    // WHY .all() + Locator: p.$$() returns ElementHandle which lacks
    // pressSequentially in TypeScript types. Locator.all() gives us Locator
    // objects where pressSequentially is properly typed.
    const customSections = await p.locator('.application-question').all();
    for (const section of customSections) {
      const questionText = (
        (await section.locator('label, .question-label').first().textContent().catch(() => '')) ?? ''
      ).trim();
      if (!questionText) continue;

      const answerObj = this.answers.generate(questionText, {
        company: context.job.company,
        role: context.job.title,
        jd: context.job.jd,
      });

      if (!answerObj) {
        this.log.warn(`No answer for Lever question: "${questionText.slice(0, 80)}"`);
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
          this.log.warn(`Lever text field failed for "${questionText.slice(0, 60)}": ${(err as Error).message}`);
          fieldsFailed.push({ selector: 'input/textarea', reason: `"${questionText.slice(0, 60)}"` });
        }
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
      notes: 'Lever form filled. Review cover letter, then submit manually.',
    };
  }
}
