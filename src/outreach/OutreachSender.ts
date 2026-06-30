/**
 * Orchestrates a daily email batch: gate every draft, send the green ones under
 * the daily cap, and record receipts in the outreach log. Event recording lives
 * in THIS one layer (the Mailer records nothing), the single-writer discipline
 * the M7 review made load-bearing.
 *
 * Receipt order per contact: email_verified BEFORE the SMTP call (a durable
 * "passed the gate, attempting to send" breadcrumb), then email_sent ONLY after
 * the server confirms delivery. An unconfirmed send records email_abstained and
 * notifies; it never records email_sent (the LIVE-submit false-green lesson).
 * Because no email_sent lands, the contact is not suppressed and the next run
 * can retry, while the OutreachStore guard blocks a true duplicate send.
 */

import fs from 'fs';
import path from 'path';
import type { EmailDraft } from './types.js';
import type { DraftGate } from './DraftGate.js';
import type { Mailer, Attachment } from './Mailer.js';
import type { OutreachStore } from './OutreachStore.js';
import type { NotifySink } from '../applier/Notifier.js';

export interface SenderDeps {
  gate: DraftGate;
  mailer: Mailer;
  store: OutreachStore;
  notify?: NotifySink;
  /** Max emails sent per calendar day across all runs. */
  dailyCap?: number;
  resumeDir?: string;
  clock?: () => Date;
}

export interface SendSummary {
  sent: EmailDraft[];
  abstained: Array<{ draft: EmailDraft; reasons: string[] }>;
  /** Drafts that passed the gate but were not sent because the daily cap was reached. */
  capSkipped: EmailDraft[];
}

export class OutreachSender {
  private readonly gate: DraftGate;
  private readonly mailer: Mailer;
  private readonly store: OutreachStore;
  private readonly notify?: NotifySink;
  private readonly dailyCap: number;
  private readonly resumeDir: string;
  private readonly clock: () => Date;

  constructor(deps: SenderDeps) {
    this.gate = deps.gate;
    this.mailer = deps.mailer;
    this.store = deps.store;
    this.notify = deps.notify;
    this.dailyCap = deps.dailyCap ?? 10;
    this.resumeDir = deps.resumeDir ?? 'output/resumes';
    this.clock = deps.clock ?? (() => new Date());
  }

  async sendBatch(drafts: EmailDraft[]): Promise<SendSummary> {
    const summary: SendSummary = { sent: [], abstained: [], capSkipped: [] };
    let remaining = Math.max(0, this.dailyCap - this.countSentToday());

    for (const draft of drafts) {
      const outcome = this.gate.evaluate(draft);
      if (outcome.decision === 'abstain') {
        this.store.append({
          type: 'email_abstained',
          contactId: draft.contactId,
          payload: { to: draft.to, reasons: outcome.reasons },
        });
        summary.abstained.push({ draft, reasons: outcome.reasons });
        continue;
      }

      if (remaining <= 0) {
        summary.capSkipped.push(draft);
        continue;
      }

      // The body says "I have attached my resume", so a missing attachment would
      // make the email lie to a stranger. Resolve it first and abstain if a draft
      // that promises a resume has no file on disk, rather than send a false claim.
      const attachments = this.attachmentsFor(draft);
      if (draft.resumeVariant && attachments.length === 0) {
        const reason = `resume attachment missing (expected parv-${draft.resumeVariant}.pdf); not sending an email that claims an attachment it lacks`;
        this.store.append({ type: 'email_abstained', contactId: draft.contactId, payload: { to: draft.to, reasons: [reason] } });
        summary.abstained.push({ draft, reasons: [reason] });
        this.notify?.({ kind: 'error', title: 'Outreach: resume missing', message: `${draft.to}: ${reason}`, urgent: true });
        continue;
      }

      // Durable intent receipt, written before the irreversible SMTP call.
      this.store.append({
        type: 'email_verified',
        contactId: draft.contactId,
        payload: { to: draft.to, status: draft.emailStatus, fromAccount: draft.fromAccount },
      });

      const result = await this.mailer.send(draft, attachments);
      if (result.confirmed) {
        // tryAppend, not append: between the gate's suppression read and here, a
        // concurrent reconciler could record a bounce/opt-out for this contact,
        // and the store guard would then reject email_sent. The message is
        // already delivered, so we must NOT throw (that would abort the batch
        // and strand it); we record what we can and flag the rare race.
        const verdict = this.store.tryAppend({
          type: 'email_sent',
          contactId: draft.contactId,
          payload: {
            to: draft.to,
            fromAccount: draft.fromAccount,
            messageId: result.messageId,
            sentAt: this.clock().toISOString(),
          },
        });
        remaining--; // a message went out either way; it counts against the cap
        if (verdict.ok) {
          summary.sent.push(draft);
        } else {
          this.notify?.({
            kind: 'error',
            title: 'Outreach delivered but NOT recorded',
            message: `${draft.to}: sent over SMTP, but the log rejected the receipt (${verdict.reason}). Likely a concurrent bounce or opt-out. Check manually.`,
            urgent: true,
          });
        }
      } else {
        this.store.append({
          type: 'email_abstained',
          contactId: draft.contactId,
          payload: { to: draft.to, reasons: [`send unconfirmed: ${result.reason}`] },
        });
        summary.abstained.push({ draft, reasons: [`send unconfirmed: ${result.reason}`] });
        this.notify?.({
          kind: 'error',
          title: 'Outreach send failed',
          message: `${draft.to}: ${result.reason}`,
          urgent: true,
        });
      }
    }

    return summary;
  }

  /**
   * Count email_sent events dated today, so the cap holds across multiple runs
   * in a day. Compares against the payload's sentAt (written from the same clock
   * the cap uses); falls back to the event ts for legacy rows. WHY not e.ts: ts
   * is real wall-clock at append time, so under an injected clock it disagrees
   * with `today` and silently defeats the cap.
   */
  private countSentToday(): number {
    const today = this.clock().toISOString().slice(0, 10);
    return this.store.readAll().events.filter((e) => {
      if (e.type !== 'email_sent') return false;
      const when = typeof e.payload.sentAt === 'string' ? e.payload.sentAt : e.ts;
      return when.slice(0, 10) === today;
    }).length;
  }

  private attachmentsFor(draft: EmailDraft): Attachment[] {
    if (!draft.resumeVariant) return [];
    const file = path.join(this.resumeDir, `parv-${draft.resumeVariant}.pdf`);
    if (!fs.existsSync(file)) return [];
    return [{ filename: `Parv-Patodia-${draft.resumeVariant}.pdf`, path: file }];
  }
}
