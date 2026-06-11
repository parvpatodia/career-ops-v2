/**
 * Shared browser session factory used by both the apply loop and the login
 * setup script.
 *
 * WHY stealth configuration:
 * Playwright's default Chromium sets navigator.webdriver = true and exposes
 * several automation-specific properties. Bot-detection systems (Cloudflare,
 * DataDome, Wellfound's custom check) block the login page outright when they
 * see these signals. Two mitigations:
 *
 * 1. channel: 'chrome' — use the system-installed Google Chrome instead of
 *    Playwright's bundled Chromium. Real Chrome has legitimate browser
 *    fingerprints (GL renderer, canvas hash, font list) that pass bot checks.
 *    Falls back to bundled Chromium if Chrome is not installed.
 *
 * 2. --disable-blink-features=AutomationControlled + addInitScript —
 *    removes the CDP automation flag from navigator and window objects,
 *    which is the simplest signal most bot-detection systems look for.
 *
 * WHY persistent context:
 * launchPersistentContext writes cookies/localStorage to PROFILE_DIR after
 * every page. The next process launch reads them back, so platform logins
 * (Handshake, LinkedIn, Wellfound) survive process restarts.
 */

import path from 'path';
import fs from 'fs';
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';

export const PROFILE_DIR = path.resolve('.browser-profile');
export const CDP_PORT    = 9271;

const STEALTH_ARGS = [
  `--remote-debugging-port=${CDP_PORT}`,
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-service-autorun',
  '--password-store=basic',
  '--use-mock-keychain',
];

// Masks navigator.webdriver and removes Playwright-specific window properties.
// Injected into every page before any script runs.
const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  delete window.__playwright;
  delete window.__pw_manual;
  delete window.__pwInitScripts;
`;

/**
 * Opens a persistent browser context from PROFILE_DIR using stealth config.
 * Tries Google Chrome first; falls back to Playwright's bundled Chromium.
 * Returns the context — caller is responsible for closing it.
 */
export async function launchStealthContext(): Promise<{ ctx: BrowserContext; usingChrome: boolean }> {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // Try system Chrome first — real fingerprints pass Wellfound / Cloudflare checks
  try {
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: false,
      args: STEALTH_ARGS,
    });
    await ctx.addInitScript(STEALTH_INIT_SCRIPT);
    return { ctx, usingChrome: true };
  } catch {
    // Chrome not installed or not found — fall back to bundled Chromium
  }

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: STEALTH_ARGS,
  });
  await ctx.addInitScript(STEALTH_INIT_SCRIPT);
  return { ctx, usingChrome: false };
}
