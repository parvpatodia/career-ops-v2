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

const TRUTHY = new Set(['yes', 'true', 'on', '1', 'i agree', 'agree']);

export class WorkdayDriver implements WorkdayPageDriver {
  constructor(private readonly page: Page) {}

  private sel(automationId: string): string {
    return `[data-automation-id="${automationId}"]`;
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

  async fill(intent: FieldIntent): Promise<void> {
    const loc = this.page.locator(this.sel(intent.field.id)).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 5_000 });

    switch (intent.field.type) {
      case 'file':
        await loc.setInputFiles(intent.value);
        return;
      case 'select':
      case 'multiselect':
        await this.fillSelect(intent);
        return;
      case 'checkbox':
        await loc.setChecked(TRUTHY.has(intent.value.toLowerCase()), { timeout: 5_000 });
        return;
      case 'radio':
        // Click the radio whose automation-id matches; value semantics vary by tenant.
        await loc.check({ timeout: 5_000 });
        return;
      default:
        await loc.click({ timeout: 5_000 });
        await loc.selectText().catch(() => this.page.keyboard.press('Control+a'));
        await this.page.keyboard.press('Delete');
        await loc.pressSequentially(intent.value, { delay: 25 });
    }
  }

  async readBack(field: FormField): Promise<string | null> {
    const loc = this.page.locator(this.sel(field.id)).first();
    try {
      if (field.type === 'select' || field.type === 'multiselect') {
        // Native <select>: read the selected option's text. Custom Workday
        // dropdowns expose their choice as the control's text/value.
        const selected = await loc
          .evaluate((el) => {
            const s = el as HTMLSelectElement;
            if (s.options && typeof s.selectedIndex === 'number') {
              return s.options[s.selectedIndex]?.text ?? '';
            }
            return (el as HTMLElement).innerText ?? '';
          })
          .catch(() => '');
        const text = (selected ?? '').trim();
        return text.length > 0 ? text : null;
      }

      if (field.type === 'checkbox' || field.type === 'radio') {
        const checked = await loc.isChecked().catch(() => false);
        return checked ? 'Yes' : 'No';
      }

      // text / email / phone / textarea / date / file: the input value.
      // (file inputs report the chosen file's name, which the Verifier
      // compares by basename.)
      const value = await loc.inputValue({ timeout: 3_000 }).catch(() => '');
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private async fillSelect(intent: FieldIntent): Promise<void> {
    const loc = this.page.locator(this.sel(intent.field.id)).first();
    const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');

    if (tag === 'select') {
      await loc.selectOption({ label: intent.value }, { timeout: 5_000 });
      return;
    }

    // Custom Workday dropdown: open, then click the exact-text option.
    await loc.click({ timeout: 5_000 });
    const option = this.page
      .locator('[role="option"]')
      .filter({ hasText: new RegExp(`^\\s*${intent.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') })
      .first();
    await option.click({ timeout: 5_000 });
  }
}
