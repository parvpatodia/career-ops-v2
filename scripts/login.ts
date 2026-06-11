/**
 * One-time login setup — opens each platform in the persistent stealth browser
 * so the user can log in. Sessions are saved to .browser-profile/ and reused
 * automatically by npm run apply on all future runs.
 *
 * Usage:
 *   npm run login                          → log in to all platforms
 *   npm run login -- --platform wellfound  → retry a single platform
 *
 * WHY stealth browser: Wellfound and some other platforms block Playwright's
 * default Chromium because it exposes navigator.webdriver = true. launchStealthContext
 * uses real Google Chrome (if installed) and strips automation signals.
 */

import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { launchStealthContext, PROFILE_DIR } from '../src/applier/BrowserSession.js';

const ALL_PLATFORMS = [
  { key: 'handshake', name: 'Handshake',  url: 'https://app.joinhandshake.com/users/sign_in' },
  { key: 'linkedin',  name: 'LinkedIn',   url: 'https://www.linkedin.com/login'               },
  { key: 'wellfound', name: 'Wellfound',  url: 'https://wellfound.com/login'                  },
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const platformArg = args.includes('--platform')
    ? (args[args.indexOf('--platform') + 1] ?? '').toLowerCase()
    : null;

  const platforms = platformArg
    ? ALL_PLATFORMS.filter((p) => p.key === platformArg)
    : ALL_PLATFORMS;

  if (platforms.length === 0) {
    console.error(`Unknown platform: ${platformArg}`);
    console.error(`Valid options: ${ALL_PLATFORMS.map((p) => p.key).join(', ')}`);
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║       career-ops — Platform Login Setup              ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log('  Sessions are saved to .browser-profile/ and reused automatically.');
  console.log('  You will not be prompted to log in again after this.\n');

  const { ctx, usingChrome } = await launchStealthContext();
  console.log(`  Browser: ${usingChrome ? 'Google Chrome (system)' : 'Playwright Chromium'}\n`);

  const rl = createInterface({ input: stdin, output: stdout });

  for (const platform of platforms) {
    const page = await ctx.newPage();
    await page.bringToFront();
    console.log(`  → Opening ${platform.name}`);
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    await rl.question(`  Log into ${platform.name} in the browser, then press Enter here... `);
    await page.close().catch(() => {});
    console.log(`  ✓ ${platform.name} session saved\n`);
  }

  rl.close();
  await ctx.close();

  console.log('══════════════════════════════════════════════════════');
  console.log(`  Sessions saved to: ${PROFILE_DIR}`);
  console.log('  Run: npm run apply');
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
