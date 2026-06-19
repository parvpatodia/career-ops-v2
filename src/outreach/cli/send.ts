/**
 * `npm run outreach:send` — gate today's email drafts and send the green ones.
 *
 *   npm run outreach:send                  send today's drafts
 *   npm run outreach:send -- --dry-run     gate only: print decisions, send nothing
 *   npm run outreach:send -- --date 2026-06-16   pick a specific day's draft folder
 *   npm run outreach:send -- --cap 5       override the daily send cap
 *
 * Drafts are read from data/outreach/drafts/<date>/*.json (written by the daily
 * Claude run). Drafts that fail the gate are copied to data/outreach/review/<date>/
 * for Parv, with the reasons. Receipts land in data/outreach.jsonl.
 *
 * Setup: .env needs GMAIL_USER + GMAIL_APP_PASSWORD (and optionally OUTLOOK_*),
 * the same app passwords `npm run inbox` uses. config/outreach-snippets.yml must
 * hold approved self-claims or the gate abstains everything.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { DraftLoader } from '../DraftLoader.js';
import { DraftGate } from '../DraftGate.js';
import { StyleLinter } from '../StyleLinter.js';
import { SnippetBook } from '../SnippetBook.js';
import { Mailer } from '../Mailer.js';
import { OutreachStore } from '../OutreachStore.js';
import { OutreachSender } from '../OutreachSender.js';
import { ProfileLoader } from '../../applier/ProfileLoader.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function displayName(): string {
  try {
    return new ProfileLoader().getIdentity().name || 'Parv Patodia';
  } catch {
    return 'Parv Patodia';
  }
}

async function main(): Promise<void> {
  const date = arg('--date') ?? new Date().toISOString().slice(0, 10);
  const dir = arg('--dir') ?? path.join('data/outreach/drafts', date);
  const dryRun = process.argv.includes('--dry-run');
  const cap = arg('--cap') ? parseInt(arg('--cap')!, 10) : undefined;

  const { drafts, errors } = new DraftLoader().load(dir);
  if (errors.length) {
    console.log(`Skipped ${errors.length} malformed draft(s):`);
    for (const e of errors) console.log(`  ${e.file}: ${e.reason}`);
  }
  if (drafts.length === 0) {
    console.log(`No valid drafts in ${dir}.`);
    return;
  }

  const snippetsPath = arg('--snippets');
  const store = new OutreachStore();
  const gate = new DraftGate({
    linter: new StyleLinter(),
    snippets: snippetsPath ? SnippetBook.fromYaml(snippetsPath) : SnippetBook.fromYaml(),
    isSuppressed: (id) => store.isSuppressed(id),
  });

  if (dryRun) {
    console.log(`Dry run: gating ${drafts.length} draft(s) from ${dir}, sending nothing.\n`);
    let pass = 0;
    for (const d of drafts) {
      const out = gate.evaluate(d);
      if (out.decision === 'send') { pass++; console.log(`  SEND    ${d.to}  (${d.segment})`); }
      else console.log(`  ABSTAIN ${d.to}  -> ${out.reasons.join('; ')}`);
    }
    console.log(`\n${pass}/${drafts.length} would send.`);
    return;
  }

  const mailer = Mailer.fromEnv(displayName());
  if (mailer.available().length === 0) {
    console.log('No SMTP accounts configured in .env (GMAIL_USER/GMAIL_APP_PASSWORD).');
    process.exit(1);
  }

  const sender = new OutreachSender({ gate, mailer, store, ...(cap !== undefined ? { dailyCap: cap } : {}) });
  const summary = await sender.sendBatch(drafts);

  // Write abstained drafts to the review pile so Parv can fix and resend.
  if (summary.abstained.length) {
    const reviewDir = path.join('data/outreach/review', date);
    fs.mkdirSync(reviewDir, { recursive: true });
    for (const { draft, reasons } of summary.abstained) {
      fs.writeFileSync(
        path.join(reviewDir, `${draft.contactId}.json`),
        JSON.stringify({ ...draft, abstainReasons: reasons }, null, 2)
      );
    }
  }

  console.log(`Sent ${summary.sent.length}, abstained ${summary.abstained.length}, cap-skipped ${summary.capSkipped.length}.`);
  for (const d of summary.sent) console.log(`  SENT    ${d.to}  (${d.segment})`);
  for (const { draft, reasons } of summary.abstained) console.log(`  REVIEW  ${draft.to}  -> ${reasons.join('; ')}`);
  for (const d of summary.capSkipped) console.log(`  CAPPED  ${d.to}  (daily cap reached)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
