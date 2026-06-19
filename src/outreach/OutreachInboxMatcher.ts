/**
 * Pure matcher for outreach inbox reconcile. Two signals matter after a cold
 * email goes out: the person replied (a live thread, stop cold-emailing them),
 * or it bounced (bad address, never send there again). No IMAP here, the same
 * split as EmailMatcher: thin IO fetches headers, this interprets them.
 *
 * Reply matching is reliable: a reply's From address equals the address we
 * emailed. Bounce-to-contact matching is best-effort from headers alone, since
 * the failed address usually lives in the message BODY, not the envelope; we
 * catch the cases where a contacted address appears in the bounce subject and
 * surface the rest as unmatched for a human to check.
 */

import type { EmailHeader } from '../inbox/EmailMatcher.js';

export interface OutreachInboxMatch {
  contactId: string;
  from: string;
  subject: string;
  date: string;
  account: string;
}

export interface OutreachInboxResult {
  replies: OutreachInboxMatch[];
  bounces: OutreachInboxMatch[];
  /** Bounce emails we could not tie to a contacted address (need the body). */
  unmatchedBounces: number;
}

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;
const BOUNCE_SUBJECT = /undeliverable|delivery (status notification|has failed|incomplete)|mail delivery failed|address not found|returned to sender|failure notice|message not delivered/i;

function norm(s: string): string {
  return (s ?? '').toLowerCase().trim();
}

/** Pull the bare address out of a From header like "Name <a@b.com>" or "a@b.com". */
export function extractAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  if (angled?.[1]) return norm(angled[1]);
  const bare = from.match(/[^\s,;<>]+@[^\s,;<>]+/);
  return bare ? norm(bare[0]) : '';
}

function isBounce(email: EmailHeader): boolean {
  return BOUNCE_FROM.test(email.from) || BOUNCE_SUBJECT.test(email.subject);
}

export class OutreachInboxMatcher {
  /**
   * @param emails inbound headers
   * @param contactedByEmail map of normalized address -> contactId for everyone we emailed
   */
  match(emails: EmailHeader[], contactedByEmail: Map<string, string>): OutreachInboxResult {
    const result: OutreachInboxResult = { replies: [], bounces: [], unmatchedBounces: 0 };

    for (const email of emails) {
      if (isBounce(email)) {
        const hit = this.addressInText(email.subject, contactedByEmail);
        if (hit) {
          result.bounces.push({ contactId: hit, from: email.from, subject: email.subject, date: email.date, account: email.account });
        } else {
          result.unmatchedBounces++;
        }
        continue;
      }
      const contactId = contactedByEmail.get(extractAddress(email.from));
      if (contactId) {
        result.replies.push({ contactId, from: email.from, subject: email.subject, date: email.date, account: email.account });
      }
    }

    return result;
  }

  /**
   * The LONGEST contacted address that appears verbatim in the text, or
   * undefined. Longest-match makes it deterministic and avoids a shorter address
   * that is a substring of another contacted address ("ob@x.com" inside
   * "bob@x.com") winning by iteration order.
   */
  private addressInText(text: string, contactedByEmail: Map<string, string>): string | undefined {
    const t = norm(text);
    let best: string | undefined;
    let bestLen = 0;
    for (const [addr, contactId] of contactedByEmail) {
      if (addr && addr.length > bestLen && t.includes(addr)) {
        best = contactId;
        bestLen = addr.length;
      }
    }
    return best;
  }
}
