/**
 * Shared DOM fill/read primitives, used by every portal's FormSource. The
 * TECHNIQUE is identical across ATSes (React inputs need the full keydown
 * chain, native <select> vs react-select differ, files go through
 * setInputFiles, checkboxes are boolean); only the SELECTOR differs per portal,
 * so callers pass their own Locator. Keeping this in one place stops the v1
 * problem of fill logic drifting between handlers.
 *
 * WHY pressSequentially: React-controlled inputs listen to keydown/keyup;
 * fill() fires only an InputEvent and leaves React state stale, so the field
 * looks filled but reads back empty.
 */

import type { Locator, Page } from 'playwright';
import type { FieldIntent, FormField } from './IntentPayload.js';
import { isAffirmative } from './Verifier.js';

export async function fillControl(page: Page, locator: Locator, intent: FieldIntent): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });

  switch (intent.field.type) {
    case 'file':
      await locator.setInputFiles(intent.value);
      return;
    case 'select':
    case 'multiselect':
      await fillSelect(page, locator, intent.value);
      return;
    case 'checkbox':
      await locator.setChecked(isAffirmative(intent.value), { timeout: 5_000 });
      return;
    default:
      await locator.click({ timeout: 5_000 });
      await locator.selectText().catch(() => page.keyboard.press('Control+a'));
      await page.keyboard.press('Delete');
      await locator.pressSequentially(intent.value, { delay: 25 });
  }
}

export async function readControl(locator: Locator, field: FormField): Promise<string | null> {
  try {
    if (field.type === 'select' || field.type === 'multiselect') {
      // Native <select>: the selected option's text. Custom (react-select)
      // controls expose their choice as the control's text.
      const selected = await locator
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

    if (field.type === 'checkbox') {
      const checked = await locator.isChecked().catch(() => false);
      return checked ? 'Yes' : 'No';
    }

    // text / email / phone / textarea / date / file: the input value. (file
    // inputs report the chosen file's name, which the Verifier compares by
    // basename.)
    const value = await locator.inputValue({ timeout: 3_000 }).catch(() => '');
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function fillSelect(page: Page, locator: Locator, value: string): Promise<void> {
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');

  if (tag === 'select') {
    await locator.selectOption({ label: value }, { timeout: 5_000 });
    return;
  }

  // Custom (react-select / listbox) dropdown: open, then click the exact-text option.
  await locator.click({ timeout: 5_000 });
  const option = page
    .locator('[role="option"]')
    .filter({ hasText: new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') })
    .first();
  await option.click({ timeout: 5_000 });
}
