/**
 * Real-DOM proof for CaptchaDetector. The unit tests cover the pure precedence
 * (pickCaptcha) and the crash-safe wiring, but the safety depends on the
 * SELECTORS actually matching real captcha widgets — if they miss, the
 * autonomous path would blind-submit into a wall. This drives detectCaptcha
 * against real Chromium DOM for each widget kind + a clean form.
 *
 * Usage: npm run demo:captcha
 *
 * WHY separate from `npx vitest run`: it needs a browser; the gate stays
 * browser-free (M0 fresh-clone lesson). NEVER touches the network, an ATS, or
 * the event log — it loads inline HTML via setContent.
 */

import { chromium } from 'playwright';
import { detectCaptcha } from '../src/applier/CaptchaDetector.js';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// Markup mirrors how each provider renders on a real application form.
const CASES: { name: string; html: string; expect: string | null }[] = [
  {
    name: 'Greenhouse reCAPTCHA v2 (visible checkbox)',
    html: `<form><input id="email"><div class="g-recaptcha" data-sitekey="x"></div>
           <iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe></form>`,
    expect: 'recaptcha',
  },
  {
    name: 'hCaptcha',
    html: `<form><input id="email"><div class="h-captcha" data-sitekey="x"></div>
           <iframe src="https://newassets.hcaptcha.com/captcha/v1/abc/frame"></iframe></form>`,
    expect: 'hcaptcha',
  },
  {
    name: 'Cloudflare Turnstile',
    html: `<form><input id="email"><div class="cf-turnstile" data-sitekey="x"></div></form>`,
    expect: 'turnstile',
  },
  {
    name: 'invisible reCAPTCHA v3 badge only (NO human action -> not a blocker)',
    html: `<form><input id="email"><div class="grecaptcha-badge"></div></form>`,
    expect: null,
  },
  {
    name: 'clean application form (no captcha)',
    html: `<form><input id="first_name"><input id="email"><textarea id="why"></textarea></form>`,
    expect: null,
  },
];

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let pass = 0;
  try {
    for (const c of CASES) {
      await page.setContent(c.html, { waitUntil: 'domcontentloaded' });
      const got = (await detectCaptcha(page))?.kind ?? null;
      const ok = got === c.expect;
      if (ok) pass++;
      console.log(`  ${ok ? green('PASS ✓') : red('FAIL ✗')}  ${c.name}`);
      console.log(`         expected ${String(c.expect)}, got ${String(got)}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`\n  ${pass === CASES.length ? green('ALL GREEN') : red('FAILURES')}: ${pass}/${CASES.length}\n`);
  if (pass !== CASES.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
