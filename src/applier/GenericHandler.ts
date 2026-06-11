/**
 * Generic fallback form filler for unknown ATS systems (TikTok Careers,
 * Tesla, iCIMS, custom portals, etc.).
 *
 * WHY no 'input:visible' fallback: The previous buildSelector() fell back to
 * 'input:visible' when id and name were both absent. This selected the FIRST
 * visible input on the entire page — so iterating over N fields would overwrite
 * the same input N times with the last value processed. Now we skip any field
 * that has no stable selector rather than corrupt an unrelated field.
 *
 * WHY AnswerGenerator instead of inline logic: Centralizes answer logic so
 * all handlers stay in sync when profile data changes.
 *
 * KNOWN LIMITATION: iCIMS renders inside a cross-origin iframe. page.$$()
 * cannot see cross-origin iframe content. Fields in iCIMS iframes will always
 * appear in the "needs manual input" list. This is fundamental to browser
 * security (same-origin policy) — no automation can work around it without
 * the user navigating directly to the iframe URL.
 */

import fs from 'fs';
import path from 'path';
import type { ApplyContext, ApplyResult } from './Applier.js';
import { Applier } from './Applier.js';
import type { ElementHandle } from 'playwright';
import { UniversalFormFiller } from './UniversalFormFiller.js';

export class GenericHandler extends Applier {
  readonly ats = 'generic';

  protected async fill(context: ApplyContext): Promise<ApplyResult> {
    const identity = this.profile.getIdentity();
    let fieldsFilledCount = 0;
    const fieldsFailed: ApplyResult['fieldsFailed'] = [];
    const screeningQuestions: ApplyResult['screeningQuestions'] = [];
    const p = this.page!;

    await p.waitForTimeout(2_000);

    // ── Pass 1: UniversalFormFiller (DOM-injection sweep) ─────────────────
    // WHY first: Fills standard fields universally using the live DOM context,
    // the same technique browser extensions use. Works on any site without
    // needing site-specific selectors.
    try {
      const uff = new UniversalFormFiller();
      const uffResult = await uff.fill(p, this.profile);
      fieldsFilledCount += uffResult.filled;
      this.log.info(`UniversalFormFiller: filled ${uffResult.filled} fields, skipped ${uffResult.skipped.length}`);
    } catch (err) {
      this.log.warn(`UniversalFormFiller failed: ${(err as Error).message}`);
    }

    // Collect all visible, interactable input fields
    const fields = await p.$$(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
      ':not([type="checkbox"]):not([type="radio"]):not([type="file"]), ' +
      'textarea, select'
    );

    for (const field of fields) {
      const tagName = await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
      const id       = ((await field.getAttribute('id'))          ?? '').toLowerCase();
      const name     = ((await field.getAttribute('name'))        ?? '').toLowerCase();
      const placeholder = ((await field.getAttribute('placeholder')) ?? '').toLowerCase();
      const label    = await this.findLabel(field);
      const labelLC  = label.toLowerCase();

      // Build context string for pattern matching
      const ctx = `${id} ${name} ${placeholder} ${labelLC}`.trim();
      if (!ctx) continue; // skip fields with no identifying info

      // Get a stable selector — skip if none (prevents the 'input:visible' bug)
      const selector = await this.buildStableSelector(field);
      if (!selector) {
        this.log.warn(`Generic: skipping field with no stable selector (no id or name)`);
        if (label) {
          screeningQuestions.push({ question: label, answer: '[NEEDS MANUAL INPUT — no stable selector]', flagged: true });
        }
        continue;
      }

      let answer = '';

      // Pattern-match to known fields
      if (/first.?name|firstname|given.?name/.test(ctx)) {
        answer = identity.firstName;
      } else if (/last.?name|lastname|surname/.test(ctx)) {
        answer = identity.lastName;
      } else if (/\bname\b/.test(ctx) && !/company|school|employer|university/.test(ctx)) {
        answer = identity.name;
      } else if (/email/.test(ctx)) {
        answer = identity.email;
      } else if (/phone|tel/.test(ctx)) {
        answer = identity.phone;
      } else if (/linkedin/.test(ctx)) {
        answer = identity.linkedin;
      } else if (/github/.test(ctx)) {
        answer = identity.github;
      } else if (/website|portfolio/.test(ctx)) {
        answer = identity.portfolio ?? identity.github;
      } else if (/\bcity\b/.test(ctx) && !/school|company/.test(ctx)) {
        answer = identity.city;
      } else if (/\bstate\b/.test(ctx) && !/school|company/.test(ctx)) {
        answer = identity.state;
      } else if (/zip|postal/.test(ctx)) {
        answer = identity.zip;
      } else if (/university|school|college|institution/.test(ctx)) {
        answer = identity.university;
      } else if (/\bdegree\b|education.level/.test(ctx)) {
        answer = "Master's in Artificial Intelligence";
      } else if (/\bgpa\b/.test(ctx)) {
        answer = identity.gpa;
      } else if (/graduation|grad.?date/.test(ctx)) {
        answer = identity.graduation;
      } else if (/start.?date|available/.test(ctx)) {
        answer = this.profile.getApplicationDefaults().startDate;
      } else if (/hear.about|find.out|referr/.test(ctx)) {
        answer = this.profile.getApplicationDefaults().howDidYouHear;
      } else if (label) {
        // Use AnswerGenerator for labeled fields we didn't pattern-match above
        const answerObj = this.answers.generate(label, {
          company: context.job.company,
          role: context.job.title,
          jd: context.job.jd,
        });
        if (answerObj) {
          answer = answerObj.value;
          if (answerObj.needsReview) {
            screeningQuestions.push({
              question: label,
              answer: `[${answerObj.confidence === 'low' ? 'FLAGGED' : 'NEEDS REVIEW'}] ${answerObj.value}`,
              flagged: true,
            });
          }
        }
      }

      if (answer && tagName !== 'select') {
        if (await this.safeType(selector, answer)) {
          fieldsFilledCount++;
        } else {
          fieldsFailed.push({ selector, reason: `label: "${label || ctx.slice(0, 40)}"` });
        }
      }

      // Collect unhandled fields for the review summary
      if (!answer && label && !['submit', 'upload', 'file', 'button'].some((w) => labelLC.includes(w))) {
        screeningQuestions.push({
          question: label,
          answer: '[NEEDS MANUAL INPUT]',
          flagged: true,
        });
      }
    }

    // ── File upload: resume ───────────────────────────────────────────────
    if (context.pdfPath && fs.existsSync(context.pdfPath)) {
      try {
        // Try specific PDF resume input first, then any file input
        const resumeInput = await p.$(
          'input[type="file"][accept*="pdf"], input[type="file"][name*="resume"], input[type="file"][id*="resume"]'
        ) ?? await p.$('input[type="file"]');
        if (resumeInput) {
          await resumeInput.setInputFiles(context.pdfPath);
          fieldsFilledCount++;
          this.log.info(`Uploaded resume: ${context.pdfPath}`);
        }
      } catch (err) {
        this.log.warn(`Generic: resume upload failed: ${(err as Error).message}`);
        fieldsFailed.push({ selector: 'input[type="file"]', reason: (err as Error).message });
      }
    }

    // ── File upload: cover letter ─────────────────────────────────────────
    // WHY variant-based: select the PDF that matches the resume variant so the
    // cover letter and resume are always aligned for the same role type.
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
          this.log.info(`Uploaded cover letter: ${clPdfPath}`);
        }
      } catch (err) {
        this.log.warn(`Generic: cover letter upload failed: ${(err as Error).message}`);
      }
    }

    return {
      jobId: context.job.id,
      ats: this.ats,
      fieldsFilledCount,
      fieldsFailed,
      screeningQuestions,
      stoppedAt: p.url() ?? '',
      readyForSubmit: true,
      notes: `Generic handler: filled ${fieldsFilledCount} fields. ` +
             `${screeningQuestions.filter((q) => q.flagged).length} field(s) need manual input.`,
    };
  }

  private async findLabel(field: ElementHandle): Promise<string> {
    const ariaLabel = await field.getAttribute('aria-label').catch(() => null);
    if (ariaLabel?.trim()) return ariaLabel.trim();

    const id = await field.getAttribute('id').catch(() => null);
    if (id) {
      const label = await this.page!.$(`label[for="${id}"]`).catch(() => null);
      const text = await label?.textContent().catch(() => null);
      if (text?.trim()) return text.trim();
    }

    const placeholder = await field.getAttribute('placeholder').catch(() => null);
    if (placeholder?.trim()) return placeholder.trim();

    return '';
  }

  // WHY no 'input:visible' fallback: That selector matches the FIRST visible
  // input on the page regardless of which field we're targeting, causing
  // all subsequent safeType calls to overwrite the same input.
  // WHY attribute selector for id: CSS.escape is a browser API, not available
  // in Node.js. [id="..."] with escaped quotes covers all valid HTML IDs.
  private async buildStableSelector(field: ElementHandle): Promise<string | null> {
    const id = await field.getAttribute('id').catch(() => null);
    if (id?.trim()) return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;

    const name = await field.getAttribute('name').catch(() => null);
    if (name?.trim()) return `[name="${name}"]`;

    // No stable selector — return null so caller can skip safely
    return null;
  }
}
