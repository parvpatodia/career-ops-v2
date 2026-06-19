/**
 * GenericFormSource: the vendor-neutral fallback. It DISCOVERS labeled fields
 * from the rendered DOM of ANY ATS (the breadth the competitor gets from a
 * generic Playwright fill) but routes them through the SAME IntentPayload +
 * independent read-back Verifier as our first-class adapters (the safety the
 * competitor lacks — they trust the agent's self-graded confidence).
 *
 * Result: breadth AND verify-or-abstain. An unknown question, a legal/EEO field
 * without a human-approved answer, an unfillable widget, or a read-back mismatch
 * all abstain — never a blind guess, never a false "submitted".
 *
 * NEVER SUBMITS: like every AtsFormSource, it has no submit method.
 */

import type { Page } from 'playwright';
import type { AtsFormSource, NormalizedSchema, EeoField, UnmappedField } from './ApplicationAdapter.js';
import type { FieldIntent, FormField } from './IntentPayload.js';
import { fillControl, readControl } from './DomControls.js';
import { detectCaptcha } from './CaptchaDetector.js';

interface RawField {
  id: string;
  label: string;
  tag: string;
  type: string;
  reactSelect: boolean;
  required: boolean;
}

const DEMOGRAPHIC = /gender|race|ethnic|hispanic|latino|veteran|disab|pronoun|sexual orientation|transgender/i;

export class GenericFormSource implements AtsFormSource {
  readonly ats: string;

  constructor(private readonly page: Page, ats = 'generic') {
    this.ats = ats;
  }

  // A login wall is a human touchpoint, not something to fill: a password field
  // with no application fields present. (Captchas are handled at submit time —
  // the Autopilot records submit_unconfirmed and hands off.)
  async isAuthWall(): Promise<boolean> {
    if (typeof this.page?.evaluate !== 'function') return false;
    return this.page
      .evaluate(() => {
        const hasPassword = !!document.querySelector('input[type="password"]');
        const hasAppFields = !!document.querySelector(
          'input[id*="name" i], input[id*="email" i], textarea, [class*="select__control"]'
        );
        return hasPassword && !hasAppFields;
      })
      .catch(() => false);
  }

  async scanSchema(): Promise<NormalizedSchema> {
    const raw = await this.discover();
    const fields: FormField[] = [];
    const eeo: EeoField[] = [];
    const unmapped: UnmappedField[] = [];

    for (const f of raw) {
      // Demographic/self-ID: surfaced for the human, never auto-filled (inv. 7).
      if (DEMOGRAPHIC.test(f.label)) {
        eeo.push({ id: f.id, label: f.label });
        continue;
      }
      const type = this.inferType(f);
      if (type === null) {
        // A widget we cannot fill safely (e.g. radio group): required -> abstain.
        unmapped.push({ id: f.id, label: f.label, required: f.required, widget: f.tag + '/' + f.type });
        continue;
      }
      fields.push({ id: f.id, label: f.label, type, required: f.required });
    }
    const captcha = await detectCaptcha(this.page);
    return { fields, eeo, unmapped, ...(captcha ? { captcha } : {}) };
  }

  fill(intent: FieldIntent): Promise<void> {
    return fillControl(this.page, this.locate(intent.field.id), intent);
  }

  readBack(field: FormField): Promise<string | null> {
    return readControl(this.locate(field.id), field);
  }

  // ── SubmitDriver surface (used by the Autopilot only after a verified verdict
  //    + approval; a null confirmation -> submit_unconfirmed, never a false submit).
  async clickSubmit(): Promise<void> {
    const btn = this.page
      .locator('button[type="submit"], input[type="submit"], button:has-text("Submit application"), button:has-text("Submit")')
      .first();
    await btn.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await btn.click({ timeout: 10_000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await this.page.waitForTimeout(1_500);
  }

  async readConfirmation(): Promise<string | null> {
    const body = await this.page.locator('body').innerText().catch(() => '');
    const m = body.match(
      /thank(s| you) for applying[^.\n]*|your application (has been )?(submitted|received)[^.\n]*|we('| ha)ve received your application[^.\n]*|application submitted[^.\n]*|successfully (applied|submitted)[^.\n]*/i
    );
    if (m) return m[0].replace(/\s+/g, ' ').trim().slice(0, 120);
    const url = this.page.url();
    if (/confirmation|thank|submitted|success/i.test(url)) return `submitted (url: ${url})`;
    return null;
  }

  private locate(id: string) {
    return this.page.locator(`[id="${id}"]`).first();
  }

  private inferType(f: RawField): FormField['type'] | null {
    if (f.type === 'file') return 'file';
    if (f.type === 'checkbox') return 'checkbox';
    if (f.type === 'radio') return null; // unmapped: never guess a radio (LESSONS 2026-06-15)
    if (f.type === 'email') return 'email';
    if (f.type === 'tel') return 'phone';
    if (f.type === 'date') return 'date';
    if (f.tag === 'textarea') return 'textarea';
    if (f.tag === 'select' || f.reactSelect) return 'select';
    return 'text';
  }

  private async discover(): Promise<RawField[]> {
    if (typeof this.page?.evaluate !== 'function') return [];
    const raw = await this.page
      .evaluate(() => {
        const out: Array<{ id: string; label: string; tag: string; type: string; reactSelect: boolean; required: boolean }> = [];
        const controls = document.querySelectorAll('input[id], select[id], textarea[id]');
        for (const el of Array.from(controls)) {
          const e = el as HTMLInputElement;
          const t = (e.type || '').toLowerCase();
          if (t === 'hidden' || t === 'submit' || t === 'button' || /recaptcha/i.test(e.id)) continue;
          let label = '';
          const forLabel = document.querySelector('label[for="' + e.id + '"]');
          if (forLabel) label = (forLabel as HTMLElement).innerText.trim();
          if (!label) {
            const wrap = e.closest('[class*=field], .form-group, fieldset');
            const inner = wrap ? wrap.querySelector('label, .label, legend') : null;
            if (inner) label = (inner as HTMLElement).innerText.trim();
          }
          if (!label) continue; // unlabeled control -> not safely fillable
          const reactSelect = !!e.closest('.select__control');
          const required = e.required || e.getAttribute('aria-required') === 'true' || /\*/.test(label);
          out.push({ id: e.id, label: label.replace(/\*/g, '').trim(), tag: e.tagName.toLowerCase(), type: t, reactSelect, required });
        }
        return out;
      })
      .catch(() => [] as RawField[]);
    // De-dupe by id (react-select renders a hidden + visible input sharing an id base).
    const seen = new Set<string>();
    return raw.filter((f) => f.id && !seen.has(f.id) && (seen.add(f.id), true));
  }
}
