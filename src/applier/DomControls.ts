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
 *
 * WHY a react-select branch: modern Greenhouse (job-boards.greenhouse.io)
 * renders dropdowns as react-select (a combobox <input> inside a
 * .select__control, chosen value shown in .select__single-value), not a native
 * <select>. The classic-form assumption read those back as null. We open + type,
 * WAIT for the menu (async typeaheads fetch options after a debounce), then click
 * ONLY a confident match (exact after stripping a trailing dial code, or a unique
 * prefix); an ambiguous value abstains rather than guess (invariant 1). Read back
 * the .select__single-value.
 *
 * WHY files read via files[0].name: Playwright's inputValue() THROWS on an
 * <input type=file> ("cannot be read"), so the old read-back returned null and
 * a correctly-attached resume failed verification. The file's name is read off
 * the element instead.
 */

import path from 'path';
import type { Locator, Page } from 'playwright';
import type { FieldIntent, FormField } from './IntentPayload.js';
import { isAffirmative } from './Verifier.js';

export async function fillControl(page: Page, locator: Locator, intent: FieldIntent): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });

  switch (intent.field.type) {
    case 'file':
      // Absolute path so it resolves regardless of the process cwd.
      await locator.setInputFiles(path.resolve(intent.value));
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
    if (field.type === 'file') {
      // inputValue() throws on a file input; read the attached file's name.
      const name = await locator
        .evaluate((el) => {
          const input = el as HTMLInputElement;
          return input.files && input.files[0] ? input.files[0].name : '';
        })
        .catch(() => '');
      return name && name.length > 0 ? name : null;
    }

    if (field.type === 'select' || field.type === 'multiselect') {
      // Native <select>: the selected option's text. react-select: the
      // .select__single-value inside the enclosing control. Fallback: innerText.
      const selected = await locator
        .evaluate((el) => {
          const s = el as HTMLSelectElement;
          if (s.options && typeof s.selectedIndex === 'number' && s.selectedIndex >= 0) {
            return s.options[s.selectedIndex]?.text ?? '';
          }
          const control = (el as HTMLElement).closest?.('.select__control');
          const single = control?.querySelector('.select__single-value');
          if (single) return single.textContent ?? '';
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

    // text / email / phone / textarea / date: the input value.
    const value = await locator.inputValue({ timeout: 3_000 }).catch(() => '');
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function fillSelect(page: Page, locator: Locator, value: string): Promise<void> {
  const kind = await locator
    .evaluate((el) => {
      if (el.tagName.toLowerCase() === 'select') return 'native';
      if ((el as HTMLElement).closest?.('.select__control')) return 'react-select';
      return 'custom';
    })
    .catch(() => 'custom');

  if (kind === 'native') {
    await locator.selectOption({ label: value }, { timeout: 5_000 });
    return;
  }

  if (kind === 'react-select') {
    await fillReactSelect(page, locator, value);
    return;
  }

  // Legacy custom listbox: open, then click the exact-text option.
  await locator.click({ timeout: 5_000 });
  const option = page
    .locator('[role="option"]')
    .filter({ hasText: new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') })
    .first();
  await option.click({ timeout: 5_000 });
}

/**
 * Fill a react-select combobox: open the control, type to filter, WAIT for the
 * menu to render (async typeaheads such as a location/city field fetch options
 * after a debounce, so matching immediately finds nothing or a stale menu), then
 * click ONLY a confident match. If the value is ambiguous (many "San Jose, …"
 * rows) or absent, the menu is closed and the field left unset — verify-or-abstain
 * forbids guessing an option (invariant 1); the read-back then flags it for a human.
 */
async function fillReactSelect(page: Page, input: Locator, value: string): Promise<void> {
  const control = input.locator('xpath=ancestor::*[contains(@class,"select__control")][1]');
  await control.click({ timeout: 5_000 }).catch(() => {});
  await input.pressSequentially(value, { delay: 30 }).catch(() => {});

  const options = page.locator('.select__menu .select__option, .select__menu [role="option"]');
  // Wait for at least one option to render (covers the async-fetch typeaheads).
  await options.first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
  const texts = await options.allInnerTexts().catch(() => [] as string[]);

  const idx = confidentOptionIndex(texts, value);
  if (idx >= 0) {
    await options.nth(idx).click({ timeout: 5_000 }).catch(() => {});
  } else {
    // No confident match — do not guess. Close the menu; the field stays unset.
    await page.keyboard.press('Escape').catch(() => {});
  }
}

/**
 * Normalize a react-select option label for matching: drop a trailing phone dial
 * code ("United States+1" -> "united states"), collapse whitespace, lowercase.
 */
export function normalizeReactOption(label: string): string {
  return label.replace(/\+\d+\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The index of the ONE option that confidently matches `value`, or -1. Confident
 * means: an exact normalized equality, or a UNIQUE normalized prefix match. Any
 * ambiguity (zero or multiple prefix matches, e.g. several "San Jose, …" cities)
 * returns -1 so the filler abstains instead of picking a wrong option. Pure, so
 * the safety-critical selection rule is unit-tested without a browser.
 */
export function confidentOptionIndex(optionTexts: string[], value: string): number {
  const v = value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!v) return -1;
  const norm = optionTexts.map(normalizeReactOption);
  const exact = norm.indexOf(v);
  if (exact >= 0) return exact;
  const prefixes = norm.map((t, i) => ({ t, i })).filter((o) => o.t.startsWith(v));
  return prefixes.length === 1 ? prefixes[0]!.i : -1;
}
