/**
 * Thin IMAP IO: fetch recent email envelopes (from / subject / date) from an
 * account. Read-only — it never marks, moves, or deletes mail. App passwords
 * come from .env (gitignored); Gmail and Outlook both support IMAP app passwords
 * with 2FA on. The EmailMatcher (pure) does the interpretation.
 */

import { ImapFlow } from 'imapflow';
import type { EmailHeader } from './EmailMatcher.js';

export interface ImapAccount {
  account: string; // label, e.g. 'gmail' | 'outlook'
  host: string;
  user: string;
  password: string;
}

export const GMAIL_HOST = 'imap.gmail.com';
export const OUTLOOK_HOST = 'outlook.office365.com';

/** Read INBOX envelopes from the last `sinceDays` days. Read-only. */
export async function fetchRecentHeaders(acct: ImapAccount, sinceDays = 30): Promise<EmailHeader[]> {
  const client = new ImapFlow({
    host: acct.host,
    port: 993,
    secure: true,
    auth: { user: acct.user, pass: acct.password },
    logger: false,
  });

  const out: EmailHeader[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - sinceDays * 86_400_000);
      for await (const msg of client.fetch({ since }, { envelope: true })) {
        const env = msg.envelope;
        const from = (env?.from ?? []).map((a) => a.address ?? a.name ?? '').filter(Boolean).join(', ');
        out.push({
          from,
          subject: env?.subject ?? '',
          date: (env?.date ?? new Date()).toISOString(),
          account: acct.account,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

/** Build the configured accounts from environment app passwords (.env). */
export function accountsFromEnv(env: NodeJS.ProcessEnv = process.env): ImapAccount[] {
  const accts: ImapAccount[] = [];
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    accts.push({ account: 'gmail', host: GMAIL_HOST, user: env.GMAIL_USER, password: env.GMAIL_APP_PASSWORD });
  }
  if (env.OUTLOOK_USER && env.OUTLOOK_APP_PASSWORD) {
    accts.push({ account: 'outlook', host: OUTLOOK_HOST, user: env.OUTLOOK_USER, password: env.OUTLOOK_APP_PASSWORD });
  }
  return accts;
}
