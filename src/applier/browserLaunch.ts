/**
 * Browser launch + window-focus helpers for the apply flow.
 *
 * WHY real Chrome (channel 'chrome'), not bundled Chromium: Parv runs this on
 * his own machine and wants the captcha/login windows to be his real Google
 * Chrome (legitimate fingerprints, his extensions/sessions). Falls back to
 * bundled Chromium only if Chrome is not installed, so a fresh clone still runs.
 *
 * WHY activateChrome: the osascript desktop-notification banner is attributed to
 * "Script Editor", so clicking it opens an empty Script Editor, NOT the browser
 * (Parv's exact complaint). The reliable way to put a captcha in front of the
 * user is to raise the Chrome window itself. page.bringToFront() raises the tab;
 * the osascript `activate` raises the macOS app window. Both are best-effort.
 */

import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { execFile } from 'child_process';

/**
 * AppleScript to read the name of the frontmost macOS app. Pure + exported so
 * the command is unit-tested without running osascript.
 */
export function frontmostAppScript(): string {
  return 'tell application "System Events" to get name of first process whose frontmost is true';
}

/**
 * AppleScript to bring a named macOS PROCESS back to the front. WHY the process
 * name (not `tell application X to activate`): the frontmost-process name (e.g.
 * "Code", "iTerm2") is not always a valid `tell application` target, but System
 * Events matches it consistently. The name is quote-escaped for the literal.
 */
export function restoreAppScript(name: string): string {
  const safe = name.replace(/["\\]/g, '');
  return `tell application "System Events" to set frontmost of (first process whose name is "${safe}") to true`;
}

/** Name of the frontmost macOS app right now (null off macOS / on failure). */
export async function frontmostApp(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', frontmostAppScript()], { timeout: 3_000 }, (err, stdout) => {
      const name = (stdout ?? '').trim();
      resolve(err || !name ? null : name);
    });
  });
}

/**
 * Return focus to a previously-frontmost app (best-effort). WHY: launching a
 * headed browser for the background autofill activates Chrome and yanks the
 * user's screen to it — Parv's exact complaint. We open the window, then call
 * this so the fill happens BEHIND the user's work; only the human touchpoint
 * (captcha/submit) raises Chrome via bringToFront.
 */
export async function restoreApp(name: string | null): Promise<void> {
  if (process.platform !== 'darwin' || !name) return;
  await new Promise<void>((resolve) => {
    execFile('osascript', ['-e', restoreAppScript(name)], { timeout: 3_000 }, () => resolve());
  });
}

export async function launchChrome(opts: { headless: boolean }): Promise<{ browser: Browser; usingChrome: boolean }> {
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: opts.headless });
    return { browser, usingChrome: true };
  } catch {
    // Chrome not installed / not found — fall back so the system still runs.
    const browser = await chromium.launch({ headless: opts.headless });
    return { browser, usingChrome: false };
  }
}

/** Raise the Google Chrome app window to the front (macOS only, best-effort). */
export async function activateChrome(): Promise<void> {
  if (process.platform !== 'darwin') return;
  await new Promise<void>((resolve) => {
    execFile('osascript', ['-e', 'tell application "Google Chrome" to activate'], { timeout: 3_000 }, () => resolve());
  });
}

/** Put this page's window in front of the user (tab + macOS app window). */
export async function bringToFront(page: Page): Promise<void> {
  await page.bringToFront().catch(() => {});
  await activateChrome();
}
