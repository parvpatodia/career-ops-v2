/**
 * `npm run inbox` — reconcile application status from your Gmail + Outlook
 * inboxes (read-only). A confirmation email marks the application Applied (the
 * ground-truth proof a submission was received), a rejection/interview email
 * advances its status. Closed/terminal applications are never reopened.
 *
 * Setup (one-time): with 2FA on each account, generate an APP PASSWORD and add
 * to .env (gitignored):
 *   GMAIL_USER=you@gmail.com
 *   GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
 *   OUTLOOK_USER=you@outlook.com
 *   OUTLOOK_APP_PASSWORD=xxxxxxxxxxxxxxxx
 *
 * Usage: npm run inbox  [--days 30]
 */

import 'dotenv/config';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { EmailTracker } from './EmailTracker.js';
import { fetchRecentHeaders, accountsFromEnv } from './ImapClient.js';
import { SecretVault, CredentialStore } from '../secrets/SecretVault.js';
import { OutreachStore } from '../outreach/OutreachStore.js';
import { OutreachReconciler } from '../outreach/OutreachReconciler.js';

/** Email creds from the encrypted vault override .env (vault is the secure source). */
function loadCreds(): NodeJS.ProcessEnv {
  try {
    return { ...process.env, ...new CredentialStore(new SecretVault()).load() };
  } catch {
    return process.env;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1] ?? '30', 10) : 30;

  const accounts = accountsFromEnv(loadCreds());
  if (accounts.length === 0) {
    console.log('No email accounts configured. Add to .env (gitignored):');
    console.log('  GMAIL_USER=...  GMAIL_APP_PASSWORD=...   (generate an app password with 2FA on)');
    console.log('  OUTLOOK_USER=... OUTLOOK_APP_PASSWORD=...');
    return;
  }
  console.log(`Reconciling from: ${accounts.map((a) => `${a.account} (${a.user})`).join(', ')}  [last ${days}d]`);

  const tracker = new EmailTracker(new ApplicationStore(), (acct) => fetchRecentHeaders(acct, days));
  const summary = await tracker.run(accounts, days);

  console.log(`\nScanned ${summary.emailsScanned} emails, matched ${summary.matched}, updated ${summary.updates.length}:`);
  for (const u of summary.updates) {
    console.log(`  ${u.company.padEnd(24)} ${u.from} -> ${u.to}   ${u.account}  "${u.subject.slice(0, 50)}"`);
  }
  if (summary.updates.length === 0) console.log('  (no status changes)');

  // Outreach reconcile: replies suppress future cold emails, bounces mark dead
  // addresses. Same inbox fetch, separate log (data/outreach.jsonl).
  const outreach = new OutreachReconciler(new OutreachStore(), (acct) => fetchRecentHeaders(acct, days));
  const o = await outreach.run(accounts);
  console.log(`\nOutreach reconcile: ${o.repliesRecorded} replies, ${o.bouncesRecorded} bounces` +
    (o.unmatchedBounces ? `, ${o.unmatchedBounces} bounce(s) needing a manual check` : ''));
}

main().catch((err) => { console.error(err); process.exit(1); });
