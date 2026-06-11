/**
 * End-to-end demo — runs every ATS handler against a local HTML fixture and
 * prints a field-by-field pass/fail table plus screenshots.
 *
 * Usage: npm run demo
 *
 * WHY local HTML fixtures: Lets us exercise the real Playwright automation
 * code (pressSequentially, locator chains, element detection) without needing
 * a live browser session or real job URLs. Each fixture mirrors the exact DOM
 * selectors the corresponding handler targets.
 *
 * WHY setPageContext + fillOnExistingPage instead of fillAndStop:
 * fillAndStop() calls page.goto() which would navigate away from the fixture.
 * setPageContext injects our pre-loaded page, fillOnExistingPage calls fill()
 * directly — no navigation, no CDP reconnect, no external network.
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { GreenhouseHandler }  from '../src/applier/GreenhouseHandler.js';
import { LeverHandler }       from '../src/applier/LeverHandler.js';
import { AshbyHandler }       from '../src/applier/AshbyHandler.js';
import { WorkdayHandler }     from '../src/applier/WorkdayHandler.js';
import { EasyApplyHandler }   from '../src/applier/EasyApplyHandler.js';
import { HandshakeHandler }   from '../src/applier/HandshakeHandler.js';
import { GenericHandler }     from '../src/applier/GenericHandler.js';
import type { ApplyContext, ApplyResult } from '../src/applier/Applier.js';
import type { Job, TailoringResult } from '../src/types.js';

// ── ANSI colour helpers ───────────────────────────────────────────────────────

const C = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ── Expected values from profile.yml (via ProfileLoader normalisation) ────────

const EXPECTED = {
  firstName : 'Parv',
  lastName  : 'Patodia',
  fullName  : 'Parv Patodia',
  email     : 'patodia.pa@northeastern.edu',
  phone     : '555-555-0142',
  linkedin  : 'https://linkedin.com/in/parvpatodia',
  github    : 'https://github.com/parvpatodia',
  university: 'Northeastern University Silicon Valley',
  graduation: 'May 2027',
  city      : 'San Jose',
  state     : 'CA',
  zip       : '95126',
  address   : '754 The Alameda, San Jose, CA 95126',
};

type VerifyCheck = { selector: string; label: string; expected: string };

// ── Shared ApplyContext ───────────────────────────────────────────────────────

function makeContext(jobId = 'demo-001'): ApplyContext {
  const job: Job = {
    id: jobId,
    title: 'Machine Learning Engineer Intern',
    company: 'Demo Corp',
    url: 'about:blank',
    applyUrl: 'about:blank',
    platform: 'direct',
    location: 'San Jose, CA',
    remote: false,
    postedAt: '2026-05-04',
    discoveredAt: '2026-05-04',
    jd: 'We are looking for an ML Engineer Intern with Python, PyTorch, and computer vision experience. ' +
        'Must have valid work authorization. Prior experience with diffusion models and robotics is a plus. ' +
        'You will join our AI research team in San Jose, CA (hybrid).',
    score: 95,
    status: 'evaluated',
  };
  const tailoring: TailoringResult = {
    jobId,
    resumeVariant: 'ai',
    injectedKeywords: [],
    tailoredResumePath: '',
    pdfPath: undefined,
    coverLetterPath: undefined,
    tailoredAt: new Date().toISOString(),
  };
  return { job, tailoring, pdfPath: undefined };
}

// ── Per-ATS verification checks ───────────────────────────────────────────────

const CHECKS: Record<string, VerifyCheck[]> = {
  greenhouse: [
    { selector: '#first_name',   label: 'First Name',  expected: EXPECTED.firstName  },
    { selector: '#last_name',    label: 'Last Name',   expected: EXPECTED.lastName   },
    { selector: '#email',        label: 'Email',       expected: EXPECTED.email      },
    { selector: '#phone',        label: 'Phone',       expected: EXPECTED.phone      },
    { selector: '#question_100', label: 'Work Auth?',  expected: 'Yes'               },
    { selector: '#question_200', label: 'Sponsorship?',expected: 'No'                },
    { selector: '#question_300', label: 'Heard via?',  expected: 'LinkedIn'          },
  ],
  lever: [
    { selector: 'input[name="name"]',           label: 'Full Name', expected: EXPECTED.fullName  },
    { selector: 'input[name="email"]',          label: 'Email',     expected: EXPECTED.email     },
    { selector: 'input[name="phone"]',          label: 'Phone',     expected: EXPECTED.phone     },
    { selector: 'input[name="org"]',            label: 'Org',       expected: 'Northeastern University' },
    { selector: 'input[name="urls[LinkedIn]"]', label: 'LinkedIn',  expected: EXPECTED.linkedin  },
    { selector: 'input[name="urls[GitHub]"]',   label: 'GitHub',    expected: EXPECTED.github    },
  ],
  ashby: [
    { selector: 'input[name="_systemfield_name"]',  label: 'Full Name', expected: EXPECTED.fullName },
    { selector: 'input[name="_systemfield_email"]', label: 'Email',     expected: EXPECTED.email    },
    { selector: 'input[name="_systemfield_phone"]', label: 'Phone',     expected: EXPECTED.phone    },
    { selector: 'input[placeholder="LinkedIn"]',    label: 'LinkedIn',  expected: EXPECTED.linkedin },
    { selector: 'input[placeholder="GitHub"]',      label: 'GitHub',    expected: EXPECTED.github   },
  ],
  workday: [
    { selector: '[data-automation-id="legalNameSection_firstName"]', label: 'First Name', expected: EXPECTED.firstName },
    { selector: '[data-automation-id="legalNameSection_lastName"]',  label: 'Last Name',  expected: EXPECTED.lastName  },
    { selector: '[data-automation-id="email"]',                      label: 'Email',      expected: EXPECTED.email     },
    { selector: '[data-automation-id="phone-number"]',               label: 'Phone',      expected: EXPECTED.phone     },
  ],
  linkedin: [
    { selector: '#easyApply-firstName', label: 'First Name', expected: EXPECTED.firstName },
    { selector: '#easyApply-lastName',  label: 'Last Name',  expected: EXPECTED.lastName  },
    { selector: '#easyApply-phone',     label: 'Phone',      expected: EXPECTED.phone     },
  ],
  handshake: [
    { selector: 'input[name="first_name"]', label: 'First Name', expected: EXPECTED.firstName },
    { selector: 'input[name="last_name"]',  label: 'Last Name',  expected: EXPECTED.lastName  },
    { selector: 'input[name="email"]',      label: 'Email',      expected: EXPECTED.email     },
    { selector: 'input[name="phone"]',      label: 'Phone',      expected: EXPECTED.phone     },
  ],
  generic: [
    { selector: '[id="applicant_first_name"]', label: 'First Name',  expected: EXPECTED.firstName  },
    { selector: '[id="applicant_last_name"]',  label: 'Last Name',   expected: EXPECTED.lastName   },
    { selector: '[id="email_address"]',        label: 'Email',       expected: EXPECTED.email      },
    { selector: '[id="phone_number"]',         label: 'Phone',       expected: EXPECTED.phone      },
    { selector: '[id="linkedin_url"]',         label: 'LinkedIn',    expected: EXPECTED.linkedin   },
    { selector: '[id="github_url"]',           label: 'GitHub',      expected: EXPECTED.github     },
    { selector: '[id="school_name"]',          label: 'University',  expected: EXPECTED.university },
    { selector: '[id="graduation_date"]',      label: 'Graduation',  expected: EXPECTED.graduation },
    { selector: '[id="city"]',                 label: 'City',        expected: EXPECTED.city       },
    { selector: '[id="zip_code"]',             label: 'ZIP',         expected: EXPECTED.zip        },
  ],
};

// ── Verification helper ───────────────────────────────────────────────────────

async function runVerification(
  page: Page,
  checks: VerifyCheck[],
): Promise<{ passed: number; failed: number; rows: string[] }> {
  let passed = 0;
  let failed = 0;
  const rows: string[] = [];

  for (const { selector, label, expected } of checks) {
    const actual = await page
      .locator(selector).first()
      .inputValue({ timeout: 2_000 })
      .catch(() => '<not found>');

    const trimmed = actual.trim();
    const ok = trimmed.toLowerCase().includes(expected.toLowerCase()) ||
               expected.toLowerCase().includes(trimmed.toLowerCase()) && trimmed.length > 0;

    if (ok) {
      passed++;
      rows.push(
        `  ${C.green('✓')}  ${label.padEnd(14)} : ${C.green(trimmed.slice(0, 60))}`
      );
    } else {
      failed++;
      rows.push(
        `  ${C.red('✗')}  ${label.padEnd(14)} : ` +
        `got ${C.red(`"${trimmed.slice(0, 40)}"`)}, ` +
        `expected ${C.yellow(`"${expected.slice(0, 40)}"`)}`
      );
    }
  }

  return { passed, failed, rows };
}

// ── Single-ATS runner ─────────────────────────────────────────────────────────

async function runAts(
  atsName: string,
  fixtureFile: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HandlerClass: new () => any,
  browser: Browser,
  checks: VerifyCheck[],
): Promise<boolean> {
  console.log(`\n${'═'.repeat(54)}`);
  console.log(C.bold(C.cyan(`  ${atsName.toUpperCase().padEnd(12)} — Demo Corp | ML Eng Intern`)));
  console.log(`${'═'.repeat(54)}`);

  const fixturePath = path.resolve('tests/demo/fixtures', fixtureFile);
  const fixtureUrl  = `file://${fixturePath}`;
  const shotPath    = path.resolve('output/demo', `${atsName}.png`);

  const context = browser.contexts()[0] ?? await browser.newContext();
  const page    = await context.newPage();

  try {
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  } catch (err) {
    console.log(C.red(`  Navigation failed: ${(err as Error).message}`));
    await page.close().catch(() => {});
    return false;
  }

  // Inject handler and run fill
  const handler = new HandlerClass() as InstanceType<typeof HandlerClass>;
  handler.setPageContext(browser, page);

  let result: ApplyResult;
  const context_ = makeContext(`demo-${atsName}`);
  try {
    result = await handler.fillOnExistingPage(context_);
  } catch (err) {
    console.log(C.red(`  Handler threw: ${(err as Error).message}`));
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    await page.close().catch(() => {});
    return false;
  }

  // Verify filled values
  const { passed, failed, rows } = await runVerification(page, checks);

  console.log(`\n  ${C.bold('Field Verification:')}`);
  for (const row of rows) console.log(row);

  // Screening questions
  if (result.screeningQuestions.length > 0) {
    console.log(`\n  ${C.bold('Screening Questions:')}`);
    for (const q of result.screeningQuestions) {
      const icon = q.flagged ? C.yellow('⚑') : C.green('✓');
      console.log(`  ${icon}  ${q.question.slice(0, 55).padEnd(55)} → ${C.dim(q.answer.slice(0, 50))}`);
    }
  }

  // Summary
  console.log(`\n  Filled: ${C.green(String(result.fieldsFilledCount))}  |  Failed: ${result.fieldsFailed.length > 0 ? C.red(String(result.fieldsFailed.length)) : C.green('0')}  |  Flagged: ${result.screeningQuestions.filter((q) => q.flagged).length}`);

  if (result.fieldsFailed.length > 0) {
    console.log(`\n  ${C.yellow('Missed fields:')}`);
    for (const f of result.fieldsFailed) {
      console.log(`  ${C.dim('•')} ${f.selector}  →  ${f.reason}`);
    }
  }

  // Screenshot
  fs.mkdirSync('output/demo', { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
  console.log(`\n  Screenshot → ${C.dim(shotPath)}`);

  const pass = failed === 0;
  console.log(`\n  ${pass ? C.green('PASS ✓') : C.red('FAIL ✗')}  (${passed}/${passed + failed} field checks passed)`);

  await page.close().catch(() => {});
  return pass;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(C.bold('\n╔══════════════════════════════════════════════════════╗'));
  console.log(C.bold(  '║      career-ops — ATS Autofill End-to-End Demo      ║'));
  console.log(C.bold(  '╚══════════════════════════════════════════════════════╝'));
  console.log(C.dim(`\n  Profile : config/profile.yml → Parv Patodia`));
  console.log(C.dim(  `  Fixtures: tests/demo/fixtures/*.html`));
  console.log(C.dim(  `  Mode    : headless Chromium (local HTML, no network)\n`));

  const browser = await chromium.launch({ headless: true });

  const suites: Array<[string, string, new () => object]> = [
    ['greenhouse', 'greenhouse.html', GreenhouseHandler],
    ['lever',      'lever.html',      LeverHandler],
    ['ashby',      'ashby.html',      AshbyHandler],
    ['workday',    'workday.html',    WorkdayHandler],
    ['linkedin',   'linkedin.html',   EasyApplyHandler],
    ['handshake',  'handshake.html',  HandshakeHandler],
    ['generic',    'generic.html',    GenericHandler],
  ];

  const results: Record<string, boolean> = {};

  for (const [name, fixture, Handler] of suites) {
    results[name] = await runAts(name, fixture, Handler, browser, CHECKS[name] ?? []);
  }

  await browser.close();

  // ── Final scorecard ──────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(54)}`);
  console.log(C.bold('  DEMO SCORECARD'));
  console.log(`${'═'.repeat(54)}`);

  let total = 0;
  let passing = 0;
  for (const [name, pass] of Object.entries(results)) {
    total++;
    if (pass) passing++;
    const icon = pass ? C.green('PASS ✓') : C.red('FAIL ✗');
    console.log(`  ${icon}  ${name}`);
  }

  console.log(`${'─'.repeat(54)}`);
  console.log(`  ${passing}/${total} ATS handlers passed all field checks`);
  console.log(`  Screenshots → ${path.resolve('output/demo')}/\n`);

  if (passing < total) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
