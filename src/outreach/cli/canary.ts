/**
 * `npm run outreach:canary` — live end-to-end proof of the send path. It builds
 * one draft addressed to YOURSELF, runs it through the real gate + Mailer +
 * receipt recorder (into a TEMP log, so the real data/outreach.jsonl stays
 * clean), and prints whether the server confirmed delivery.
 *
 *   npm run outreach:canary                 send to GMAIL_USER
 *   npm run outreach:canary -- you@x.com    send to a specific address
 *
 * This is the M2/M3 acceptance check: a real email arrives in your inbox and the
 * temp log shows email_verified then email_sent. It needs .env SMTP creds.
 */

import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DraftGate } from '../DraftGate.js';
import { StyleLinter } from '../StyleLinter.js';
import { SnippetBook } from '../SnippetBook.js';
import { Mailer } from '../Mailer.js';
import { OutreachStore } from '../OutreachStore.js';
import { OutreachSender } from '../OutreachSender.js';
import { contactIdForEmail } from '../events.js';
import type { EmailDraft } from '../types.js';

const CLAIM = 'This is a canary test message from my own outreach system.';

async function main(): Promise<void> {
  const to = process.argv[2] ?? process.env.GMAIL_USER;
  if (!to) {
    console.log('No recipient. Pass one or set GMAIL_USER in .env:  npm run outreach:canary -- you@x.com');
    process.exit(1);
  }

  const mailer = Mailer.fromEnv('Parv Patodia (canary)');
  if (mailer.available().length === 0) {
    console.log('No SMTP accounts in .env (GMAIL_USER/GMAIL_APP_PASSWORD).');
    process.exit(1);
  }

  const personalization = `Sending this to ${to} to verify the pipeline.`;
  const draft: EmailDraft = {
    contactId: contactIdForEmail(to),
    to,
    fromAccount: mailer.available()[0]!,
    subject: 'Outreach canary',
    body: `Hi,\n\n${personalization}\n\n${CLAIM}\n\nIf you got this, sending works.\n\nParv`,
    segment: 'industry',
    personalization,
    sourceUrl: 'https://localhost/canary',
    claimKeys: ['canary'],
    // Force the gate's verified check; the canary is about the SEND path, not Hunter.
    emailStatus: 'valid',
  };

  const tmpLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'canary-')), 'outreach.jsonl');
  const store = new OutreachStore(tmpLog);
  const gate = new DraftGate({
    linter: new StyleLinter(),
    snippets: new SnippetBook({ canary: CLAIM }),
    isSuppressed: (id) => store.isSuppressed(id),
  });

  const summary = await new OutreachSender({ gate, mailer, store }).sendBatch([draft]);

  if (summary.sent.length === 1) {
    console.log(`OK: server confirmed delivery to ${to}. Check that inbox.`);
    console.log(`Receipts (temp log ${tmpLog}):`);
    for (const e of store.readAll().events) console.log(`  ${e.type}  ${JSON.stringify(e.payload)}`);
  } else {
    const reason = summary.abstained[0]?.reasons.join('; ') ?? 'unknown';
    console.log(`FAILED: not sent. Reason: ${reason}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
