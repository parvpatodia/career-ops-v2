/**
 * Greenhouse ATS form filler — tested against job-boards.greenhouse.io.
 *
 * WHY pressSequentially: React controlled inputs need full keydown/keyup
 * chain. fill() only fires `input`; some React components ignore it.
 *
 * WHY [role="option"]: ARIA roles are stable across react-select builds.
 * CSS class names are hashed and change with each deploy.
 *
 * WHY type full search text: Short prefixes (4 chars) match wrong entries.
 * "Nort" matches "North Carolina..." before "Northeastern University".
 * Typing 12+ chars narrows the dropdown to the target.
 *
 * WHY #country is not filled: In the new Greenhouse board, #country is the
 * intl-tel-input phone country-code selector, not a country-of-residence
 * field. Filling it would override the phone country code.
 */

import fs from 'fs';
import path from 'path';
import type { ApplyContext, ApplyResult } from './Applier.js';
import { Applier } from './Applier.js';
import { UniversalFormFiller } from './UniversalFormFiller.js';

export class GreenhouseHandler extends Applier {
  readonly ats = 'greenhouse';

  protected async fill(context: ApplyContext): Promise<ApplyResult> {
    const identity = this.profile.getIdentity();
    let fieldsFilledCount = 0;
    const fieldsFailed: ApplyResult['fieldsFailed'] = [];
    const screeningQuestions: ApplyResult['screeningQuestions'] = [];
    const p = this.page!;

    const track = (ok: boolean, selector: string, label: string): boolean => {
      if (!ok) fieldsFailed.push({ selector, reason: `${label} not filled` });
      return ok;
    };

    // Scroll full page once to trigger lazy rendering before filling
    await p.waitForTimeout(2_500);
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(800);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(500);

    // ── Core identity ─────────────────────────────────────────────────────
    if (track(await this.safeType('#first_name', identity.firstName), '#first_name', 'first_name')) fieldsFilledCount++;
    if (track(await this.safeType('#last_name', identity.lastName), '#last_name', 'last_name')) fieldsFilledCount++;
    if (track(await this.safeType('#email', identity.email), '#email', 'email')) fieldsFilledCount++;

    // Phone — set US country code via intl-tel-input API before filling digits.
    // WHY JS injection: iti stores its instance on the element under a prefixed key.
    // Calling setCountry('us') is instant and reliable; clicking the flag button
    // and searching is fragile and slow.
    try {
      const phoneLoc = p.locator('#phone').first();
      await phoneLoc.scrollIntoViewIfNeeded({ timeout: 3_000 });
      await p.evaluate(() => {
        const el = document.getElementById('phone') as HTMLInputElement | null;
        if (!el) return;
        const key = Object.keys(el).find((k) => k.startsWith('__intlTelInput'));
        if (key) {
          (el as unknown as Record<string, { setCountry(c: string): void }>)[key].setCountry('us');
          return;
        }
        const g = (window as unknown as {
          intlTelInputGlobals?: { getInstance(el: HTMLElement): { setCountry(c: string): void } | null }
        }).intlTelInputGlobals;
        g?.getInstance(el)?.setCountry('us');
      });
      await phoneLoc.click();
      await phoneLoc.selectText();
      await phoneLoc.pressSequentially(identity.phone, { delay: 40 });
      fieldsFilledCount++;
    } catch (err) {
      this.log.warn(`Phone field error: ${(err as Error).message}`);
      fieldsFailed.push({ selector: '#phone', reason: 'phone not filled' });
    }

    // ── Resume upload ─────────────────────────────────────────────────────
    if (context.pdfPath && fs.existsSync(context.pdfPath)) {
      try {
        await p.locator('#resume').setInputFiles(context.pdfPath);
        fieldsFilledCount++;
        this.log.info(`Uploaded resume: ${context.pdfPath}`);
      } catch (err) {
        this.log.warn(`Resume upload failed: ${(err as Error).message}`);
        fieldsFailed.push({ selector: '#resume', reason: 'resume upload failed' });
      }
    } else if (context.pdfPath) {
      this.log.warn(`Resume PDF not found at: ${context.pdfPath}`);
      fieldsFailed.push({ selector: '#resume', reason: `PDF not found: ${context.pdfPath}` });
    }

    // ── Cover letter (text textarea) ──────────────────────────────────────
    const clPath = context.tailoring.coverLetterPath;
    if (clPath && fs.existsSync(clPath)) {
      const raw = fs.readFileSync(clPath, 'utf8');
      const plain = raw.replace(/^#+ .+$/gm, '').replace(/\*\*/g, '').trim();
      if (track(
        await this.safeType('textarea#cover_letter, textarea[id*="cover"]', plain),
        'textarea#cover_letter', 'cover_letter'
      )) fieldsFilledCount++;
    }

    // ── Cover letter PDF upload ───────────────────────────────────────────
    // WHY: Some Greenhouse forms have a file input for cover letter upload
    // in addition to (or instead of) the textarea. Upload the PDF variant
    // that matches the resume variant.
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

    // ── Education ─────────────────────────────────────────────────────────
    // Option strings confirmed from Greenhouse DOM — these are exact match values.
    if (await this.fillCombobox('#school--0', identity.university)) fieldsFilledCount++;
    if (await this.fillCombobox('#degree--0', "Master's Degree")) fieldsFilledCount++;
    if (await this.fillCombobox('#discipline--0', 'Computer Science')) fieldsFilledCount++;
    if (await this.fillCombobox('#start-month--0', 'September')) fieldsFilledCount++;
    if (track(await this.safeType('#start-year--0', '2025'), '#start-year--0', 'start_year')) fieldsFilledCount++;
    if (await this.fillCombobox('#end-month--0', 'May')) fieldsFilledCount++;
    if (track(await this.safeType('#end-year--0', '2027'), '#end-year--0', 'end_year')) fieldsFilledCount++;

    // ── EEO (voluntary, always decline to preserve privacy) ───────────────
    await this.fillCombobox('#gender', 'Decline To Self Identify').catch(() => {});
    await this.fillCombobox('#hispanic_ethnicity', 'Decline To Self Identify').catch(() => {});
    await this.fillCombobox('#veteran_status', 'I am not a protected veteran').catch(() => {});
    await this.fillCombobox('#disability_status', 'I do not have a disability, or have a history/record of having a disability').catch(() => {});

    // ── Custom questions (id^="question_") ────────────────────────────────
    const customInputs = await p
      .$$('input[id^="question_"], textarea[id^="question_"]')
      .catch(() => [] as Awaited<ReturnType<typeof p.$$>>);

    for (const input of customInputs.slice(0, 20)) {
      const id = await input.getAttribute('id').catch(() => null);
      if (!id) continue;

      const questionText = await p.evaluate((inputId) => {
        const el = document.getElementById(inputId);
        if (!el) return '';
        const lbl = document.querySelector<HTMLElement>(`label[for="${inputId}"]`);
        if (lbl?.textContent?.trim()) return lbl.textContent.trim();
        const aria = el.getAttribute('aria-label')?.trim();
        if (aria) return aria;
        let parent = el.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!parent) break;
          const pp = parent.parentElement;
          if (pp) {
            const t = pp.querySelector<HTMLElement>(
              'label, legend, p, h3, h4, [class*="label"], [class*="question"], [class*="heading"]',
            );
            if (t && t !== el && t.textContent?.trim()) return t.textContent.trim();
          }
          parent = parent.parentElement;
        }
        return '';
      }, id);

      if (!questionText) {
        this.log.warn(`Custom field #${id} has no discoverable label — skipping`);
        continue;
      }

      const answerObj = this.answers.generate(questionText, {
        company: context.job.company,
        role: context.job.title,
        jd: context.job.jd,
      });

      if (!answerObj) {
        this.log.warn(`No answer for custom question: "${questionText.slice(0, 80)}" — needs manual input`);
        screeningQuestions.push({ question: questionText.slice(0, 120), answer: '[NEEDS MANUAL INPUT]', flagged: true });
        continue;
      }

      const displayAnswer = answerObj.needsReview
        ? `[${answerObj.confidence === 'low' ? 'FLAGGED' : 'NEEDS REVIEW'}] ${answerObj.value}`
        : answerObj.value;

      // Detect combobox: click, wait 500 ms, check if [role=option] appeared
      const isCombobox = await (async () => {
        try {
          await input.scrollIntoViewIfNeeded({ timeout: 2_000 });
          await input.click({ timeout: 2_000 });
          await p.waitForTimeout(500);
          const visible = await p.locator('[role="option"]').first().isVisible({ timeout: 800 }).catch(() => false);
          if (!visible) await p.keyboard.press('Escape');
          return visible;
        } catch { return false; }
      })();

      if (isCombobox) {
        const filled = await this.selectOpenComboboxOption(answerObj.value);
        if (filled) {
          fieldsFilledCount++;
          screeningQuestions.push({ question: questionText.slice(0, 120), answer: displayAnswer, flagged: answerObj.needsReview });
        } else {
          fieldsFailed.push({ selector: `#${id}`, reason: `combobox: no option matched "${answerObj.value.slice(0, 40)}"` });
        }
      } else {
        const loc = p.locator(`#${id}`).first();
        try {
          await loc.selectText().catch(() => p.keyboard.press('Control+a'));
          await p.keyboard.press('Delete');
          await loc.pressSequentially(answerObj.value, { delay: 20 });
          fieldsFilledCount++;
          screeningQuestions.push({ question: questionText.slice(0, 120), answer: displayAnswer, flagged: answerObj.needsReview });
        } catch (err) {
          this.log.warn(`Custom text field #${id} failed: ${(err as Error).message}`);
          fieldsFailed.push({ selector: `#${id}`, reason: (err as Error).message });
        }
      }
    }

    // ── UniversalFormFiller sweep (belt-and-suspenders) ───────────────────
    // WHY after primary fill: UFF skips already-filled fields and only fills
    // blanks, so it catches any fields the primary handler missed without
    // overwriting what was already correctly set.
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

    // Screenshot for review
    const shotPath = path.resolve('output', `gh-filled-${context.job.id}.png`);
    fs.mkdirSync('output', { recursive: true });
    await p.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    this.log.info(`Screenshot → ${shotPath}`);

    return {
      jobId: context.job.id,
      ats: this.ats,
      fieldsFilledCount,
      fieldsFailed,
      screeningQuestions,
      stoppedAt: p.url() ?? '',
      readyForSubmit: fieldsFailed.filter((f) => !f.reason.includes('not found')).length === 0,
      notes: `Screenshot at ${shotPath}`,
    };
  }

  // Clicks a combobox input and selects the matching option.
  // Two-phase: non-searchable (EEO) shows options immediately on click;
  // searchable (school, degree) require typing a prefix first.
  private async fillCombobox(selector: string, value: string): Promise<boolean> {
    try {
      const loc = this.page!.locator(selector).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 3_000 });
      await loc.click({ timeout: 3_000 });
      await this.page!.waitForTimeout(500);

      const optionLoc = this.page!.locator('[role="option"]');

      // Phase 1: non-searchable — options visible immediately after click
      if (await optionLoc.first().isVisible({ timeout: 600 }).catch(() => false)) {
        return this.selectOpenComboboxOption(value);
      }

      // Phase 2: searchable — type to filter
      await loc.selectText().catch(() => {});
      await this.page!.keyboard.press('Delete');
      const searchLen = Math.min(value.length, 12);
      await loc.pressSequentially(value.slice(0, searchLen), { delay: 50 });

      try {
        await optionLoc.first().waitFor({ state: 'visible', timeout: 3_000 });
      } catch {
        // No dropdown — treat as free-text field and type remainder
        if (value.length > searchLen) {
          await loc.pressSequentially(value.slice(searchLen), { delay: 30 });
        }
        return true;
      }

      return this.selectOpenComboboxOption(value);
    } catch (err) {
      this.log.warn(`fillCombobox [${selector}] failed: ${(err as Error).message}`);
      return false;
    }
  }

  // Selects an option from an already-open dropdown.
  // Strategy: exact text match → partial (first 10 chars) → first visible option.
  private async selectOpenComboboxOption(value: string): Promise<boolean> {
    try {
      const optionLoc = this.page!.locator('[role="option"]');
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const exact = optionLoc.filter({ hasText: new RegExp(escaped, 'i') }).first();
      if (await exact.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await exact.click({ timeout: 2_000 });
        return true;
      }

      const prefix = value.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const partial = optionLoc.filter({ hasText: new RegExp(prefix, 'i') }).first();
      if (await partial.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await partial.click({ timeout: 2_000 });
        return true;
      }

      const first = optionLoc.first();
      if (await first.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await first.click({ timeout: 2_000 });
        return true;
      }

      return false;
    } catch (err) {
      this.log.warn(`selectOpenComboboxOption failed for "${value}": ${(err as Error).message}`);
      return false;
    }
  }
}
