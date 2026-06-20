/**
 * Playwright implementation of WorkdayPageDriver over a live Page.
 *
 * WHY data-automation-id: Workday's React SPA exposes stable automation IDs
 * for its own test harnesses; CSS classes are build-hashed and change per
 * tenant version (carried over from the v1 WorkdayHandler).
 *
 * WHY the scan returns RAW descriptors only: every interpretation that can be
 * wrong (widget kind -> field type, EEO routing, required detection) lives in
 * the pure, unit-tested WorkdaySchemaMapper. This class only reports what the
 * DOM literally is, and pokes values in/out. It has no submit method, by
 * design (WorkdayPageDriver has none).
 *
 * WHY pressSequentially for text: React-controlled inputs listen to the full
 * keydown/keyup chain; fill() fires only an InputEvent and leaves React state
 * stale, so the field looks filled but is empty on read-back.
 */

import type { Page } from 'playwright';
import type { WorkdayPageDriver } from './WorkdayAdapter.js';
import type { WorkdayRawField } from './WorkdaySchemaMapper.js';
import type { FieldIntent, FormField } from './IntentPayload.js';
import { fillControl, readControl } from './DomControls.js';
import { detectCaptcha } from './CaptchaDetector.js';
import type { CaptchaSignal } from './CaptchaDetector.js';

export class WorkdayDriver implements WorkdayPageDriver {
  constructor(private readonly page: Page) {}

  private sel(automationId: string): string {
    return `[data-automation-id="${automationId}"]`;
  }

  /** Workday forms can gate submit behind a captcha; detect it so the
   *  autonomous path hands off instead of blind-submitting (invariant 6). */
  hasCaptcha(): Promise<CaptchaSignal | null> {
    return detectCaptcha(this.page);
  }

  async isAuthWall(): Promise<boolean> {
    // A Workday sign-in / create-account screen sits in front of the form.
    return this.page
      .locator(
        '[data-automation-id="signIn"], button:has-text("Sign In"), a:has-text("Sign In"), ' +
          'button:has-text("Create Account"), [data-automation-id="createAccountLink"]'
      )
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
  }

  async scan(): Promise<WorkdayRawField[]> {
    // WHY no named inner functions in here: tsx/esbuild's keepNames wraps any
    // `const fn = () => {}` with a `__name(...)` helper that does not exist in
    // the browser context, throwing "__name is not defined". Normalization is
    // inlined for that reason.
    const rows = await this.page.evaluate(() => {
      const out: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();

      for (const el of Array.from(document.querySelectorAll('[data-automation-id]'))) {
        const automationId = el.getAttribute('data-automation-id') ?? '';
        if (!automationId || seen.has(automationId)) continue;

        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') ?? '').toLowerCase();
        const role = (el.getAttribute('role') ?? '').toLowerCase();

        let widget: string | null = null;
        if (tag === 'input') {
          if (['button', 'submit', 'reset', 'hidden', 'image'].includes(type)) continue;
          if (type === 'checkbox') widget = 'checkbox';
          else if (type === 'radio') widget = 'radio';
          else if (type === 'file') widget = 'file';
          else if (type === 'email') widget = 'email';
          else if (type === 'tel') widget = 'tel';
          else if (type === 'date') widget = 'date';
          else widget = 'text';
        } else if (tag === 'textarea') {
          widget = 'textarea';
        } else if (tag === 'select') {
          widget = 'dropdown';
        } else if (role === 'combobox' || role === 'listbox' || el.getAttribute('aria-haspopup') === 'listbox') {
          widget = 'dropdown';
        } else {
          continue; // buttons, links, containers, labels: not directly fillable
        }

        // Label: aria-label, then aria-labelledby, then a nearby <label>/<legend>.
        let label = (el.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
        if (!label) {
          const lb = el.getAttribute('aria-labelledby');
          const t = lb ? document.getElementById(lb) : null;
          if (t?.textContent) label = t.textContent.replace(/\s+/g, ' ').trim();
        }
        if (!label) {
          let p: Element | null = el.parentElement;
          for (let i = 0; i < 5 && p; i++) {
            const lbl = p.querySelector('label, legend');
            const txt = (lbl?.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (txt) {
              label = txt;
              break;
            }
            p = p.parentElement;
          }
        }

        const required =
          el.hasAttribute('required') ||
          el.getAttribute('aria-required') === 'true' ||
          /\*/.test(label);
        label = label.replace(/\*/g, '').replace(/\s+/g, ' ').trim() || automationId;

        let options: string[] | undefined;
        if (tag === 'select') {
          options = Array.from(el.querySelectorAll('option'))
            .map((o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim())
            .filter((t) => t.length > 0);
        }

        let section = '';
        let anc: Element | null = el.parentElement;
        for (let i = 0; i < 6 && anc; i++) {
          const sid = anc.getAttribute('data-automation-id');
          if (sid && sid !== automationId) {
            section = sid;
            break;
          }
          anc = anc.parentElement;
        }

        seen.add(automationId);
        out.push({
          automationId,
          label,
          widget,
          required,
          ...(options ? { options } : {}),
          ...(section ? { section } : {}),
        });
      }
      return out;
    });
    return rows as unknown as WorkdayRawField[];
  }

  // NOTE on 'radio': WorkdaySchemaMapper routes radio widgets to `unmapped` (we
  // cannot yet resolve which radio in a group an answer means), so a radio
  // intent never reaches fill — never a v1-style guess at the wrong option.
  async fill(intent: FieldIntent): Promise<void> {
    await fillControl(this.page, this.page.locator(this.sel(intent.field.id)).first(), intent);
  }

  async readBack(field: FormField): Promise<string | null> {
    return readControl(this.page.locator(this.sel(field.id)).first(), field);
  }

  // ── SubmitDriver surface (used only by the Autopilot, after verify + approval) ──
  // WHY here and not on the WorkdayPageDriver the adapter holds: the fill+verify
  // maker must not be able to submit. These methods satisfy SubmitDriver
  // structurally, so the Autopilot can use the same WorkdayDriver instance for
  // submission while the adapter only ever sees the submit-free surface.

  async clickSubmit(): Promise<void> {
    const btn = this.page
      .locator(
        '[data-automation-id="submitButton"], [data-automation-id="bottom-navigation-next-button"], ' +
          'button:has-text("Submit")'
      )
      .first();
    await btn.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await btn.click({ timeout: 5_000 });
  }

  async readConfirmation(): Promise<string | null> {
    const conf = this.page
      .locator('[data-automation-id="confirmationId"], [data-automation-id="confirmationPage"]')
      .first();
    const text = await conf.textContent({ timeout: 5_000 }).catch(() => null);
    const trimmed = (text ?? '').replace(/\s+/g, ' ').trim();
    return trimmed.length > 0 ? trimmed : null;
  }

}
