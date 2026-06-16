/**
 * Pure matcher: classify application-related emails and match them to queued
 * applications by company. This is the read-only "what happened to my
 * applications" signal — a confirmation email is the GROUND-TRUTH proof a
 * submission was received (more reliable than scraping an ATS confirmation
 * page), a rejection/interview email advances the tracker's status.
 *
 * No IMAP here: takes plain email headers + the applications, returns matches.
 * The ImapClient (thin IO) fetches the headers; EmailTracker applies the status
 * changes through the single-writer store.
 */

import type { Application } from '../types.js';

export interface EmailHeader {
  from: string;
  subject: string;
  date: string; // ISO
  account: string; // 'gmail' | 'outlook'
}

export type EmailKind = 'confirmation' | 'rejection' | 'interview' | 'other';

export interface EmailMatch {
  appId: string; // legacy app id of the matched application
  company: string;
  kind: EmailKind;
  subject: string;
  from: string;
  date: string;
  account: string;
}

const CONFIRMATION = /thank(s| you) for applying|received your application|your application .{0,30}(received|submitted|complete|under review)|application (was |has been )?(received|submitted|complete)|successfully (applied|submitted)/i;
const REJECTION = /unfortunately|not (be )?(moving|proceeding) forward|decided not to (move|proceed)|other candidates|will not be moving forward|we (have )?decided to/i;
const INTERVIEW = /interview|schedule (a |your )?(call|chat|time)|next steps|would like to (chat|talk|speak|connect)|set up (a )?(call|time)|availability/i;

function norm(s: string): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Significant company tokens to look for in an email (full name + first word). */
function companyNeedles(company: string): string[] {
  const c = norm(company);
  const needles = new Set<string>([c]);
  const first = c.split(' ')[0];
  // A distinctive first token (e.g. "tenstorrent" from "Tenstorrent University
  // Jobs") so a company-shortened sender still matches; skip short/generic ones.
  if (first && first.length >= 4 && !['the', 'inc', 'labs', 'jobs'].includes(first)) needles.add(first);
  return [...needles];
}

export class EmailMatcher {
  /** Classify an email by its subject (and sender) text. */
  classify(email: EmailHeader): EmailKind {
    const text = `${norm(email.subject)} ${norm(email.from)}`;
    // Rejection/interview wording is more specific, so check before the broad
    // confirmation pattern (a rejection can also say "your application").
    if (REJECTION.test(text)) return 'rejection';
    if (INTERVIEW.test(text)) return 'interview';
    if (CONFIRMATION.test(text)) return 'confirmation';
    return 'other';
  }

  /**
   * Match application-related emails to applications. An email matches the
   * application whose company appears in its subject/sender; the most relevant
   * (status-bearing) email per application wins, newest first.
   */
  match(emails: EmailHeader[], apps: Application[]): EmailMatch[] {
    const out: EmailMatch[] = [];
    for (const app of apps) {
      const needles = companyNeedles(app.company);
      const candidates = emails
        .map((e) => ({ e, kind: this.classify(e), text: `${norm(e.subject)} ${norm(e.from)}` }))
        .filter((x) => x.kind !== 'other' && needles.some((n) => x.text.includes(n)))
        .sort((a, b) => Date.parse(b.e.date) - Date.parse(a.e.date)); // newest first

      if (candidates.length === 0) continue;
      const best = candidates[0]!;
      out.push({
        appId: app.id,
        company: app.company,
        kind: best.kind,
        subject: best.e.subject,
        from: best.e.from,
        date: best.e.date,
        account: best.e.account,
      });
    }
    return out;
  }
}

/** The application status a matched email implies (null = no change). */
export function statusForKind(kind: EmailKind): Application['status'] | null {
  switch (kind) {
    case 'confirmation': return 'Applied';
    case 'rejection': return 'Rejected';
    case 'interview': return 'Interview';
    default: return null;
  }
}
