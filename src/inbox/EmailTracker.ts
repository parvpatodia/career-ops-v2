/**
 * Reconciles application status from real inbox evidence: a confirmation email
 * is ground-truth proof an application was received (-> Applied), a rejection or
 * interview email advances the status. Read-only on the inbox; all writes go
 * through the single-writer ApplicationStore.
 *
 * Pure-ish orchestration: the email fetch is injected (real IMAP in prod, a fake
 * in tests), so the match -> status-update logic is unit-tested with no network.
 */

import { EmailMatcher, statusForKind } from './EmailMatcher.js';
import type { EmailHeader } from './EmailMatcher.js';
import type { ImapAccount } from './ImapClient.js';
import type { ApplicationStore } from '../tracker/ApplicationStore.js';
import type { ApplicationStatus } from '../types.js';
import { Logger } from '../utils/Logger.js';

export type FetchHeaders = (acct: ImapAccount) => Promise<EmailHeader[]>;

export interface TrackerUpdate {
  appId: string;
  company: string;
  from: 'Ready' | ApplicationStatus;
  to: ApplicationStatus;
  subject: string;
  account: string;
}

export interface TrackerSummary {
  emailsScanned: number;
  matched: number;
  updates: TrackerUpdate[];
}

// Don't reopen an application the user already closed out.
const TERMINAL: ReadonlySet<string> = new Set(['Closed', 'Discarded', 'SKIP', 'Rejected']);

export class EmailTracker {
  private log = new Logger('inbox');
  private matcher = new EmailMatcher();

  constructor(
    private readonly store: ApplicationStore,
    private readonly fetch: FetchHeaders
  ) {}

  async run(accounts: ImapAccount[], sinceDays = 30): Promise<TrackerSummary> {
    const emails: EmailHeader[] = [];
    for (const acct of accounts) {
      try {
        const headers = await this.fetch(acct);
        emails.push(...headers);
        this.log.info(`${acct.account}: ${headers.length} emails scanned (last ${sinceDays}d)`);
      } catch (err) {
        this.log.warn(`${acct.account}: ${(err as Error).message}`);
      }
    }

    const apps = this.store.getAll().filter((a) => !TERMINAL.has(a.status));
    const matches = this.matcher.match(emails, apps);

    const updates: TrackerUpdate[] = [];
    for (const m of matches) {
      const to = statusForKind(m.kind);
      if (!to) continue;
      const app = apps.find((a) => a.id === m.appId);
      if (!app || app.status === to) continue; // no-op if already there
      try {
        this.store.update(m.appId, { status: to, ...(to === 'Applied' ? { appliedAt: m.date } : {}) });
        updates.push({ appId: m.appId, company: m.company, from: app.status, to, subject: m.subject, account: m.account });
      } catch (err) {
        this.log.warn(`Could not update ${m.appId} (${m.company}): ${(err as Error).message}`);
      }
    }

    this.log.info(`Inbox reconcile: ${emails.length} emails, ${matches.length} matched, ${updates.length} status updates`);
    return { emailsScanned: emails.length, matched: matches.length, updates };
  }
}
