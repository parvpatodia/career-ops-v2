/**
 * Event-log schema for the outreach tracker. A SEPARATE log from the job
 * application tracker (data/outreach.jsonl, not data/events.jsonl): the job log
 * has a closed event-type whitelist and a Projection that encodes job-apply
 * transitions, so mixing outreach into it would risk AGENTS.md invariants 3 and
 * 4. This log reuses the same JsonlLog machinery with its own event vocabulary.
 *
 * The event-type list and the contact id live HERE and only here, the same
 * one-module rule the 2026-06-11 review forced on the job tracker.
 */

import { createHash } from 'crypto';

export const OUTREACH_EVENT_TYPES = [
  'contact_discovered',
  'email_drafted',
  'email_verified',
  'email_abstained',
  'email_sent',
  'reply_received',
  'bounced',
  'opted_out',
  'linkedin_drafted',
] as const;

export type OutreachEventType = (typeof OUTREACH_EVENT_TYPES)[number];

export interface OutreachEvent {
  seq: number;
  ts: string;
  type: OutreachEventType;
  contactId: string;
  payload: Record<string, unknown>;
  /** Correlation id: present when the event landed as part of an atomic group (a send receipt). */
  cid?: string;
}

const CONTACT_ID_RE = /^[0-9a-f]{12}$/;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Idempotency key for one contact, keyed on the email address: one cold email
 * per address, ever. WHY email and not name: the same person reachable at one
 * address must dedup across runs and across however their name was spelled in a
 * paper byline vs a LinkedIn headline.
 */
export function contactIdForEmail(email: string): string {
  return createHash('sha256').update(`email|${norm(email)}`).digest('hex').slice(0, 12);
}

/**
 * Idempotency key for a LinkedIn-only contact (no email yet), keyed on the
 * profile URL. Kept distinct from the email key so the two never collide.
 */
export function contactIdForProfile(linkedinUrl: string): string {
  return createHash('sha256').update(`profile|${norm(linkedinUrl)}`).digest('hex').slice(0, 12);
}

export function isValidContactId(id: string): boolean {
  return CONTACT_ID_RE.test(id);
}

/** Returns the event if the raw value has a valid envelope, else null. */
export function validateOutreachEvent(raw: unknown): OutreachEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 1) return null;
  if (typeof e.ts !== 'string') return null;
  if (typeof e.type !== 'string' || !(OUTREACH_EVENT_TYPES as readonly string[]).includes(e.type)) return null;
  if (typeof e.contactId !== 'string' || !CONTACT_ID_RE.test(e.contactId)) return null;
  if (typeof e.payload !== 'object' || e.payload === null) return null;
  if (e.cid !== undefined && typeof e.cid !== 'string') return null;
  return e as unknown as OutreachEvent;
}
