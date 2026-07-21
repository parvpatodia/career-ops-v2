/**
 * `npm run inbox:gmail` — ingest job-digest emails from Gmail over IMAP (the
 * "forward-to-Gmail" path). Fetches the newest INBOX messages WITH their raw
 * source, extracts on-field/junior/US job links via parseJobEmails (same engine
 * as the Apple Mail path), and merges them into the watcher hot-list so they show
 * in the UI beside board roles.
 *
 * WHY this over the Apple Mail reader: Gmail IMAP is reliable + fast here (the
 * AppleScript bridge hangs on the large local inbox). Credentials come from .env
 * / the encrypted vault (GMAIL_USER + a 16-char app password); this never handles
 * or prints them. Read-only: it never marks/moves/deletes mail.
 *
 * For digests that only reach the Northeastern/Outlook mailbox, forward the digest
 * senders to this Gmail so they land in INBOX; this then picks them up.
 *
 *   npm run inbox:gmail                 newest 60 msgs, 5-day window
 *   npm run inbox:gmail -- 100 7        newest 100 msgs, 7-day window
 *
 * Bodies are decoded with mailparser's simpleParser (quoted-printable, base64,
 * multipart, and charset all handled), so digests in any common encoding parse.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { simpleParser } from 'mailparser';
import { parseJobEmails, mergeHotlist } from './emailJobs.js';
import type { EmailMessage } from './emailJobs.js';
import { qpDecodeUtf8 } from './macMail.js';
import { accountsFromEnv, fetchRecentMessages } from './ImapClient.js';
import { SecretVault, CredentialStore } from '../secrets/SecretVault.js';
import { Notifier } from '../applier/Notifier.js';
import { Logger } from '../utils/Logger.js';

const HOTLIST = 'data/new-jobs.json';
const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Vault creds override .env (the vault is the secure source), like npm run inbox. */
function loadCreds(): NodeJS.ProcessEnv {
  try {
    return { ...process.env, ...new CredentialStore(new SecretVault()).load() };
  } catch {
    return process.env;
  }
}

async function main(): Promise<void> {
  const log = new Logger('gmail-inbox');
  const max = Number(process.argv[2] ?? 60);
  const days = Number(process.argv[3] ?? 5);

  const gmail = accountsFromEnv(loadCreds()).find((a) => a.account === 'gmail');
  if (!gmail) {
    log.error('no Gmail account configured (GMAIL_USER + GMAIL_APP_PASSWORD in .env or the vault)');
    process.exit(1);
  }

  let msgs;
  try {
    msgs = await fetchRecentMessages(gmail, days, max);
  } catch (err) {
    log.error(`Gmail IMAP fetch failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // Visibility: which senders are in the recent window (confirms digests arrive).
  const senders: Record<string, number> = {};
  for (const m of msgs) {
    const s = (m.from || '').toLowerCase();
    senders[s] = (senders[s] ?? 0) + 1;
  }

  // Decode each message's body robustly (simpleParser handles quoted-printable AND
  // base64 AND multipart/charset); fall back to the QP-only decoder if it throws.
  const emails: EmailMessage[] = await Promise.all(
    msgs.map(async (m): Promise<EmailMessage> => {
      let bodyHtml = '';
      try {
        const parsed = await simpleParser(m.source);
        bodyHtml = String(parsed.html || parsed.textAsHtml || parsed.text || '');
      } catch {
        bodyHtml = qpDecodeUtf8(m.source);
      }
      return { from: m.from, subject: m.subject, receivedDateTime: m.date, bodyHtml };
    })
  );
  const candidates = parseJobEmails(emails);

  let existing: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(HOTLIST, 'utf8'));
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    /* no hot-list yet is fine */
  }

  const existingIds = new Set(existing.map((e) => String((e as { id?: string }).id ?? '')));
  const existingCR = new Set(existing.map((e) => `${norm((e as { company?: string }).company)}|${norm((e as { role?: string }).role)}`));
  const fresh = candidates.filter((c) => !existingIds.has(c.id) && !existingCR.has(`${norm(c.company)}|${norm(c.role)}`));

  const merged = mergeHotlist(candidates, existing);
  fs.mkdirSync(path.dirname(HOTLIST), { recursive: true });
  fs.writeFileSync(HOTLIST, JSON.stringify(merged, null, 2) + '\n');

  if (process.env.MAIL_NO_NOTIFY !== '1') {
    const notifier = new Notifier();
    for (const j of fresh.slice(0, 8)) notifier.newPosting(j.company, j.role, j.applyUrl);
  }

  log.info(`Gmail: ${msgs.length} msg(s) -> ${candidates.length} job candidate(s), ${fresh.length} new; hot-list now ${merged.length}.`);
  log.info(`senders in window: ${Object.entries(senders).map(([s, n]) => `${n}× ${s.slice(0, 44)}`).join('  |  ') || '(none)'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
