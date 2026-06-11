/**
 * UniversalFormFiller — DOM-injection based form filler.
 *
 * WHY page.evaluate() injection instead of Playwright selectors:
 * Browser extensions like Simplify use the same technique. By running code
 * inside the page's JS context we read field labels from the live DOM
 * (aria-label, label[for=id], placeholder, parent legend/label) without
 * needing to know the site's CSS class names or selector structure in advance.
 * This works on ANY site — TikTok, ByteDance, Tesla, iCIMS, custom portals.
 *
 * WHY native value setter for React inputs:
 * React wraps native input setters with Object.defineProperty. Setting
 * el.value directly no longer triggers React's synthetic event. We must
 * use the original native setter via Object.getOwnPropertyDescriptor on
 * the prototype, then dispatch input + change events with bubbles: true.
 *
 * WHY a plain JSON profile object:
 * page.evaluate() serializes arguments via structured clone — class instances
 * (ProfileLoader) cannot be passed. We extract the scalar data we need into
 * a plain object before calling evaluate().
 */

import type { Page } from 'playwright';
import type { ProfileLoader } from './ProfileLoader.js';

// ── Serializable profile snapshot (passed into page.evaluate) ───────────────

export interface FillProfile {
  firstName:  string;
  lastName:   string;
  fullName:   string;
  email:      string;
  phone:      string;
  linkedin:   string;   // always https://
  github:     string;   // always https://
  university: string;
  city:       string;
  state:      string;
  zip:        string;
  address:    string;
  gpa:        string;
  graduation: string;
}

export interface FillResult {
  filled:  string[];
  skipped: string[];
  total:   number;
}

// ── UniversalFormFiller ──────────────────────────────────────────────────────

export class UniversalFormFiller {
  /**
   * Injects a filling function into the page's JS context and runs it against
   * every visible input/textarea/select element on the current DOM.
   *
   * Returns counts of filled and skipped fields for logging.
   */
  async fill(page: Page, profile: ProfileLoader): Promise<{ filled: number; skipped: string[] }> {
    const id = profile.getIdentity();

    // WHY plain object literal: page.evaluate() uses structured clone — class
    // instances (ProfileLoader, IdentityProfile) cannot cross the boundary.
    const fp: FillProfile = {
      firstName:  id.firstName,
      lastName:   id.lastName,
      fullName:   id.name,
      email:      id.email,
      phone:      id.phone,
      linkedin:   id.linkedin,
      github:     id.github,
      university: id.university,
      city:       id.city,
      state:      id.state,
      zip:        id.zip,
      address:    id.address,
      gpa:        id.gpa,
      graduation: id.graduation,
    };

    const result: FillResult = await page.evaluate(
      // WHY arrow function passed as a string-serializable function:
      // Playwright serializes this function and re-parses it inside the page.
      // No closure variables from Node.js are available — only the argument.
      ([profileData]: [FillProfile]): FillResult => {
        const filled:  string[] = [];
        const skipped: string[] = [];

        // ── Context extraction (runs in browser) ──────────────────────────

        function getFieldContext(el: Element): string {
          const parts: string[] = [];

          // aria-label
          const aria = el.getAttribute('aria-label');
          if (aria) parts.push(aria);

          // placeholder
          const ph = el.getAttribute('placeholder');
          if (ph) parts.push(ph);

          // name attribute
          const name = el.getAttribute('name');
          if (name) parts.push(name);

          // id attribute
          const elId = el.getAttribute('id');
          if (elId) parts.push(elId);

          // label[for=id]
          if (elId) {
            const lbl = document.querySelector<HTMLElement>(`label[for="${elId}"]`);
            if (lbl?.textContent?.trim()) parts.push(lbl.textContent.trim());
          }

          // Walk up the DOM tree to find containing label or legend text
          let parent = el.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!parent) break;
            // Direct parent is a label
            if (parent.tagName === 'LABEL') {
              const t = parent.textContent?.trim();
              if (t) parts.push(t);
              break;
            }
            // Sibling or cousin label/legend
            const found = parent.querySelector<HTMLElement>('label, legend, [class*="label"], [class*="Label"]');
            if (found && found !== el) {
              const t = found.textContent?.trim();
              if (t) parts.push(t);
            }
            parent = parent.parentElement;
          }

          return parts.join(' ').toLowerCase();
        }

        // ── Native value setter (bypasses React synthetic events) ──────────

        function nativeSet(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
          // Use the original native setter so React's synthetic event fires.
          const proto = el instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
          if (descriptor?.set) {
            descriptor.set.call(el, value);
          } else {
            (el as HTMLInputElement).value = value;
          }
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur',   { bubbles: true }));
        }

        // ── Value resolver ─────────────────────────────────────────────────

        function resolve(ctx: string, tagName: string): string | null {
          // Exclude hidden / structural indicators
          if (/password|captcha|token|csrf|hidden/.test(ctx)) return null;

          // First name (must be checked before bare "name")
          if (/first.?name|firstname|given.?name|first_name/.test(ctx)) return profileData.firstName;

          // Last name
          if (/last.?name|lastname|surname|family.?name|last_name/.test(ctx)) return profileData.lastName;

          // Full name — only when "first" / "last" are absent
          if (/\bname\b/.test(ctx) &&
              !/company|school|employer|university|college|institution|first|last|middle|preferred/.test(ctx)) {
            return profileData.fullName;
          }

          if (/email/.test(ctx)) return profileData.email;

          if (/phone|mobile|telephone/.test(ctx)) return profileData.phone;

          // LinkedIn — before generic URL patterns
          if (/linkedin/.test(ctx)) return profileData.linkedin;

          // GitHub — before generic URL patterns
          if (/github/.test(ctx)) return profileData.github;

          // Website / portfolio / personal url — map to github as portfolio
          if (/website|portfolio|personal.?url|personal.?site|web.?url|web.?address/.test(ctx) &&
              !/ email|linkedin|github/.test(ctx)) {
            return profileData.github;
          }

          // Address — guard against email address, URL fields
          if (/street.?address|mailing.?address/.test(ctx)) return profileData.address;
          if (/\baddress\b/.test(ctx) && !/email|web|url|linkedin|github/.test(ctx)) return profileData.address;

          if (/\bcity\b/.test(ctx) && !/company|school/.test(ctx)) return profileData.city;
          if (/\bstate\b/.test(ctx) && !/company|school|united.?states|work.?in/.test(ctx)) return profileData.state;
          if (/zip|postal/.test(ctx)) return profileData.zip;

          if (/university|school|college|institution/.test(ctx) && tagName !== 'select') return profileData.university;

          if (/\bgpa\b|grade.?point/.test(ctx)) return profileData.gpa;

          if (/major|field.?of.?study|area.?of.?study/.test(ctx)) return 'Artificial Intelligence';

          if (/\bdegree\b|education.?level|level.?of.?education/.test(ctx) && tagName !== 'select') return "Master's Degree";

          if (/graduation|grad.?date/.test(ctx)) return profileData.graduation;

          return null;
        }

        // ── Select helper (find matching option by text) ───────────────────

        function fillSelect(el: HTMLSelectElement, value: string): boolean {
          const lower = value.toLowerCase();
          for (let i = 0; i < el.options.length; i++) {
            const opt = el.options[i];
            if (opt.text.toLowerCase().includes(lower) ||
                opt.value.toLowerCase().includes(lower)) {
              el.selectedIndex = i;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
          return false;
        }

        // ── Main loop ──────────────────────────────────────────────────────

        const selector =
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
          ':not([type="checkbox"]):not([type="radio"]):not([type="file"]), ' +
          'textarea, select';

        const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));

        for (const el of elements) {
          // Skip invisible fields
          if ((el as HTMLElement).offsetParent === null && el.tagName !== 'SELECT') continue;

          const tagName = el.tagName.toLowerCase();
          const ctx = getFieldContext(el);
          if (!ctx) {
            skipped.push(`[no-context] ${el.tagName}`);
            continue;
          }

          const value = resolve(ctx, tagName);
          if (!value) {
            skipped.push(ctx.slice(0, 60));
            continue;
          }

          // Skip already-filled fields (don't overwrite what the primary handler set)
          if (tagName === 'input' || tagName === 'textarea') {
            const current = (el as HTMLInputElement | HTMLTextAreaElement).value;
            if (current && current.trim() !== '') {
              skipped.push(`[already-filled] ${ctx.slice(0, 40)}`);
              continue;
            }
            nativeSet(el as HTMLInputElement | HTMLTextAreaElement, value);
            filled.push(`${tagName}[${ctx.slice(0, 40)}] = "${value.slice(0, 30)}"`);
          } else if (tagName === 'select') {
            const ok = fillSelect(el as HTMLSelectElement, value);
            if (ok) {
              filled.push(`select[${ctx.slice(0, 40)}] = "${value.slice(0, 30)}"`);
            } else {
              skipped.push(`[select-no-match] ${ctx.slice(0, 40)} val="${value}"`);
            }
          }
        }

        return { filled, skipped, total: elements.length };
      },
      [fp] as [FillProfile],
    );

    return { filled: result.filled.length, skipped: result.skipped };
  }
}
