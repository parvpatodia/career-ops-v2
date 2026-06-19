/**
 * CaptchaDetector: a captcha is a designed human touchpoint (AGENTS.md
 * invariant 6 — never auto-solved, never sent to a solving service). Detecting
 * it DURING the scan, not at submit time, lets:
 *   - the autonomous path hand off BEFORE clicking submit into a wall it cannot
 *     pass (no wasted, ambiguous submit_unconfirmed), and
 *   - the attended co-pilot tell the human exactly what to solve.
 *
 * Detection is DOM-presence only (reCAPTCHA v2 / hCaptcha / Cloudflare
 * Turnstile widgets + their iframes). It NEVER interacts with the widget.
 *
 * WHY presence is enough: we never attempt to pass a captcha, so we only need
 * "is a human required here". An invisible reCAPTCHA v3 (score-based, no visible
 * challenge, only a floating .grecaptcha-badge) requires NO human action, so it
 * is deliberately NOT treated as a blocker.
 */

import type { Page } from 'playwright';

export type CaptchaKind = 'recaptcha' | 'hcaptcha' | 'turnstile';

export interface CaptchaSignal {
  kind: CaptchaKind;
}

/** Which captcha widgets the DOM scan found present. */
export interface CaptchaFlags {
  turnstile: boolean;
  hcaptcha: boolean;
  recaptcha: boolean;
}

/**
 * Pure precedence over the scanned flags: any one present means a human is
 * required, so the order only decides which kind we name. Kept pure so the
 * decision is unit-tested without a browser (the selectors are demo-proven).
 */
export function pickCaptcha(flags: CaptchaFlags): CaptchaSignal | null {
  if (flags.turnstile) return { kind: 'turnstile' };
  if (flags.hcaptcha) return { kind: 'hcaptcha' };
  if (flags.recaptcha) return { kind: 'recaptcha' };
  return null;
}

export async function detectCaptcha(page: Page): Promise<CaptchaSignal | null> {
  if (typeof page?.evaluate !== 'function') return null;
  // No named inner function inside evaluate: tsx/esbuild keepNames injects an
  // undefined __name helper into the browser and the evaluate throws (LESSONS
  // 2026-06-15). Inline every querySelector. v2 reCAPTCHA only (the .g-recaptcha
  // mount, the anchor iframe, or the titled checkbox iframe); the bare invisible
  // v3 badge needs no human action, so it is intentionally excluded.
  const flags = await page
    .evaluate(() => ({
      turnstile:
        !!document.querySelector('.cf-turnstile') ||
        !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'),
      hcaptcha:
        !!document.querySelector('.h-captcha') ||
        !!document.querySelector('iframe[src*="hcaptcha.com"]'),
      recaptcha:
        !!document.querySelector('.g-recaptcha') ||
        !!document.querySelector('iframe[src*="recaptcha"][src*="anchor"]') ||
        !!document.querySelector('iframe[title="reCAPTCHA"]'),
    }))
    .catch(() => null);
  // A non-object result (a fake page returning a bool, or a thrown evaluate)
  // means "no captcha", never a crash.
  if (!flags || typeof flags !== 'object') return null;
  return pickCaptcha(flags as CaptchaFlags);
}
