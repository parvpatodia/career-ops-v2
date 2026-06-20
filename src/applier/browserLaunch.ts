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
