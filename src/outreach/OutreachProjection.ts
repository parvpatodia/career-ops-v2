/**
 * Pure fold of outreach events into per-contact state, plus the transition
 * guard consulted before an append lands. No I/O here: OutreachStore owns the
 * file, this owns the meaning (S in SOLID), mirroring store/Projection.ts.
 */

import type { OutreachEvent } from './events.js';

export interface ContactState {
  contactId: string;
  drafted: boolean;
  verified: boolean;
  sent: boolean;
  replied: boolean;
  bounced: boolean;
  optedOut: boolean;
  linkedinDrafted: boolean;
  sentAt?: string;
}

export type CanApplyResult = { ok: true } | { ok: false; reason: string };

function blank(contactId: string): ContactState {
  return {
    contactId,
    drafted: false,
    verified: false,
    sent: false,
    replied: false,
    bounced: false,
    optedOut: false,
    linkedinDrafted: false,
  };
}

export class OutreachProjection {
  private states = new Map<string, ContactState>();

  /**
   * Transition guard. The two invariants that protect a stranger's inbox and
   * Parv's sender reputation: never email the same contact twice, and never
   * email a contact who bounced or opted out.
   */
  canApply(e: OutreachEvent): CanApplyResult {
    if (e.type !== 'email_sent') return { ok: true };
    const s = this.states.get(e.contactId);
    if (s?.sent) return { ok: false, reason: `duplicate email_sent for contact ${e.contactId}` };
    if (s?.bounced) return { ok: false, reason: `email_sent to bounced contact ${e.contactId}` };
    if (s?.optedOut) return { ok: false, reason: `email_sent to opted-out contact ${e.contactId}` };
    return { ok: true };
  }

  apply(e: OutreachEvent): void {
    const s = this.ensure(e.contactId);
    switch (e.type) {
      case 'email_drafted':
        s.drafted = true;
        break;
      case 'email_verified':
        s.verified = true;
        break;
      case 'email_sent':
        s.sent = true;
        s.sentAt = typeof e.payload.sentAt === 'string' ? e.payload.sentAt : e.ts;
        break;
      case 'reply_received':
        s.replied = true;
        break;
      case 'bounced':
        s.bounced = true;
        break;
      case 'opted_out':
        s.optedOut = true;
        break;
      case 'linkedin_drafted':
        s.linkedinDrafted = true;
        break;
      // contact_discovered, email_abstained: no state beyond existence.
      default:
        break;
    }
  }

  state(contactId: string): ContactState | undefined {
    return this.states.get(contactId);
  }

  /**
   * A contact we must not cold-email: already sent, bounced, opted out, or
   * already replied (a reply is a live thread, not a cold target). The
   * DraftGate reads this for de-duplication.
   */
  isSuppressed(contactId: string): boolean {
    const s = this.states.get(contactId);
    if (!s) return false;
    return s.sent || s.bounced || s.optedOut || s.replied;
  }

  all(): ContactState[] {
    return [...this.states.values()];
  }

  private ensure(contactId: string): ContactState {
    let s = this.states.get(contactId);
    if (!s) {
      s = blank(contactId);
      this.states.set(contactId, s);
    }
    return s;
  }
}
