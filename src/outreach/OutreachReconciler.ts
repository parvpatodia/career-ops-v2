/**
 * Reconciles outreach state from the inbox: a reply suppresses future cold
 * emails to that contact, a bounce marks the address dead. Read-only on the
 * inbox; all writes go through the single-writer OutreachStore. The fetch is
 * injected (real IMAP in prod, a fake in tests), the EmailTracker pattern.
 */

import { OutreachInboxMatcher } from './OutreachInboxMatcher.js';
import type { OutreachStore } from './OutreachStore.js';
import type { EmailHeader } from '../inbox/EmailMatcher.js';
import type { ImapAccount } from '../inbox/ImapClient.js';
import type { NotifySink } from '../applier/Notifier.js';

export type FetchHeaders = (acct: ImapAccount) => Promise<EmailHeader[]>;

export interface OutreachReconcileSummary {
  emailsScanned: number;
  repliesRecorded: number;
  bouncesRecorded: number;
  unmatchedBounces: number;
}

export class OutreachReconciler {
  private matcher = new OutreachInboxMatcher();

  constructor(
    private readonly store: OutreachStore,
    private readonly fetch: FetchHeaders,
    // Pinged when a NEW reply lands. A reply is the payoff of outreach, so Parv
    // should hear about it the moment the reconcile finds it, not by reading a log.
    private readonly notify?: NotifySink
  ) {}

  async run(accounts: ImapAccount[]): Promise<OutreachReconcileSummary> {
    const emails: EmailHeader[] = [];
    for (const acct of accounts) {
      try {
        emails.push(...(await this.fetch(acct)));
      } catch {
        // A dead account must not abort the reconcile; the EmailTracker swallows
        // per-account fetch errors the same way.
      }
    }

    const contacted = this.contactedByEmail();
    const { replies, bounces, unmatchedBounces } = this.matcher.match(emails, contacted);

    // WHY pre-seed from current state: a reply stays in the inbox for the whole
    // fetch window, so a naive append would re-record reply_received on every
    // daily run. The reconcile is idempotent because IT decides what is new (the
    // store guard stays minimal, only the send invariants). The set also dedups
    // multiple reply messages from the same contact within one run.
    const proj = this.store.projection();
    const replied = new Set(proj.all().filter((s) => s.replied).map((s) => s.contactId));
    const bounced = new Set(proj.all().filter((s) => s.bounced).map((s) => s.contactId));

    let repliesRecorded = 0;
    const replyFroms: string[] = [];
    for (const r of replies) {
      if (replied.has(r.contactId)) continue;
      this.store.append({
        type: 'reply_received',
        contactId: r.contactId,
        payload: { from: r.from, subject: r.subject, date: r.date, account: r.account },
      });
      replied.add(r.contactId);
      repliesRecorded++;
      replyFroms.push(r.from);
    }

    let bouncesRecorded = 0;
    for (const b of bounces) {
      if (bounced.has(b.contactId)) continue;
      this.store.append({
        type: 'bounced',
        contactId: b.contactId,
        payload: { from: b.from, subject: b.subject, date: b.date, account: b.account },
      });
      bounced.add(b.contactId);
      bouncesRecorded++;
    }

    if (replyFroms.length > 0 && this.notify) {
      this.notify({
        kind: 'unknown_question', // closest existing kind: "Answer needed" — a reply awaits your response
        title: `Outreach: ${replyFroms.length} repl${replyFroms.length === 1 ? 'y' : 'ies'}`,
        message: `From ${replyFroms.join(', ')}. Reply to keep it warm.`,
        urgent: true,
      });
    }

    return { emailsScanned: emails.length, repliesRecorded, bouncesRecorded, unmatchedBounces };
  }

  /**
   * Map of every address we actually emailed -> contactId, from email_sent
   * events only. WHY not all `to` payloads: email_verified and email_abstained
   * also carry `to`, so including them would let a reply from someone we
   * verified-then-abstained-on (never emailed) be recorded as a reply.
   */
  private contactedByEmail(): Map<string, string> {
    const map = new Map<string, string>();
    for (const e of this.store.readAll().events) {
      if (e.type !== 'email_sent') continue;
      const to = e.payload.to;
      if (typeof to === 'string' && to.includes('@')) map.set(to.toLowerCase().trim(), e.contactId);
    }
    return map;
  }
}
