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

/**
 * Per-provider setup state, so a half-configured account (user set, app password
 * missing — exactly the common failure) gives a precise message instead of a
 * silent "no accounts". Pure: unit-tested without a network.
 */
export function diagnoseAccounts(env: NodeJS.ProcessEnv = process.env): string[] {
  const providers: ReadonlyArray<readonly [string, string, string]> = [
    ['gmail', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'],
    ['outlook', 'OUTLOOK_USER', 'OUTLOOK_APP_PASSWORD'],
  ];
  const lines: string[] = [];
  for (const [label, userKey, passKey] of providers) {
    const hasUser = !!env[userKey];
    const hasPass = !!env[passKey];
    if (hasUser && hasPass) lines.push(`${label}: configured (${env[userKey]})`);
    else if (hasUser && !hasPass) lines.push(`${label}: ${env[userKey]} set, ${passKey} MISSING — add a 16-char app password`);
    else if (!hasUser && hasPass) lines.push(`${label}: ${passKey} set but ${userKey} MISSING`);
  }
  return lines;
}

/** Turn a raw IMAP/login error into an actionable one-liner. Pure. */
export function describeImapError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();
  if (/auth|login|credential|invalid|password|asswd|denied/.test(m)) {
    return 'login rejected — use a 16-char APP PASSWORD (not your account password); 2-Step Verification must be on';
  }
  if (/enotfound|econnrefused|etimedout|timeout|network|getaddrinfo|socket/.test(m)) {
    return 'cannot reach the mail server — check the network/host';
  }
  return raw.slice(0, 140);
}

export interface ConnCheck {
  account: string;
  user: string;
  ok: boolean;
  detail: string;
}

/** Read-only login test: connect, open INBOX, report message count, log out. */
export async function checkConnection(acct: ImapAccount): Promise<ConnCheck> {
  const client = new ImapFlow({
    host: acct.host,
    port: 993,
    secure: true,
    auth: { user: acct.user, pass: acct.password },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let count = 0;
    try {
      const mbox = client.mailbox as { exists?: number } | false;
      count = mbox && typeof mbox === 'object' ? mbox.exists ?? 0 : 0;
    } finally {
      lock.release();
    }
    await client.logout().catch(() => {});
    return { account: acct.account, user: acct.user, ok: true, detail: `connected, ${count} message(s) in INBOX` };
  } catch (err) {
    await client.logout().catch(() => {});
    return { account: acct.account, user: acct.user, ok: false, detail: describeImapError(err) };
  }
}
