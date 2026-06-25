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
 *        npm run inbox -- --check   verify each account's IMAP login (no reconcile)
 */

import 'dotenv/config';
import { ApplicationStore } from '../tracker/ApplicationStore.js';
import { EmailTracker } from './EmailTracker.js';
import { fetchRecentHeaders, accountsFromEnv, diagnoseAccounts, checkConnection } from './ImapClient.js';
import { SecretVault, CredentialStore } from '../secrets/SecretVault.js';
import { OutreachStore } from '../outreach/OutreachStore.js';
import { OutreachReconciler } from '../outreach/OutreachReconciler.js';
import { Notifier } from '../applier/Notifier.js';

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

  const env = loadCreds();
  const accounts = accountsFromEnv(env);

  // --check: verify the IMAP login for each account, no reconcile. Makes the
  // setup confirmable the moment an app password lands, with a precise message
  // for the common "user set, password missing" half-configured state.
  if (args.includes('--check')) {
    const diag = diagnoseAccounts(env);
    console.log(diag.length ? 'Email setup:\n  ' + diag.join('\n  ') : 'No email accounts set in .env or the vault.');
    if (accounts.length === 0) {
      console.log('\nNothing to test yet. Add a 16-char APP PASSWORD (not your login password):');
      console.log('  npm run secrets -- set GMAIL_APP_PASSWORD "xxxxxxxxxxxxxxxx"   (or put it in .env)');
      return;
    }
    console.log('\nTesting IMAP logins (read-only)...');
    for (const a of accounts) {
      const r = await checkConnection(a);
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.account} (${r.user}): ${r.detail}`);
    }
    return;
  }

  if (accounts.length === 0) {
    console.log('No email accounts configured. Add to .env (gitignored) or the vault:');
    const diag = diagnoseAccounts(env);
    if (diag.length) console.log('  ' + diag.join('\n  '));
    console.log('  GMAIL_USER=...  GMAIL_APP_PASSWORD=...   (generate an app password with 2FA on)');
    console.log('  OUTLOOK_USER=... OUTLOOK_APP_PASSWORD=...');
    console.log('Then verify: npm run inbox -- --check');
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
  // addresses. Same inbox fetch, separate log (data/outreach.jsonl). A new reply
  // fires a desktop notification so Parv can respond fast.
  const notifier = new Notifier();
  const outreach = new OutreachReconciler(
    new OutreachStore(),
    (acct) => fetchRecentHeaders(acct, days),
    (n) => notifier.notify(n)
  );
  const o = await outreach.run(accounts);
  console.log(`\nOutreach reconcile: ${o.repliesRecorded} replies, ${o.bouncesRecorded} bounces` +
    (o.unmatchedBounces ? `, ${o.unmatchedBounces} bounce(s) needing a manual check` : ''));
}

main().catch((err) => { console.error(err); process.exit(1); });
