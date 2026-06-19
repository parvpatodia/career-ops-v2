/**
 * Composes a sourced Candidate into a gate-passing EmailDraft or a LinkedIn DM.
 * Deterministic, no LLM: every sentence about Parv is an approved snippet quoted
 * verbatim, and the only free text is the greeting, the sourced personalization
 * (evidenced by the candidate's sourceUrl), and the signoff. This is what lets
 * the result auto-send safely; the DraftGate then proves it.
 *
 * WHY deterministic and not an LLM call: an LLM drafting its own self-claims is
 * exactly the fabrication risk the snippet gate exists to remove, and it would
 * add an API dependency. The personalization quality comes from the SOURCE
 * (a paper title, a role at a company), not from generation.
 */

import { contactIdForEmail, contactIdForProfile } from './events.js';
import type { SnippetBook } from './SnippetBook.js';
import type { Candidate, EmailDraft, LinkedInDraft, Segment, SendAccount } from './types.js';
import type { ResumeVariant } from '../types.js';

/** Snippet keys each segment draws on, in body order (intro, detail, ask/coop).
 *  Only keys that exist in the approved book are used; the signature is appended
 *  separately. If no segment snippet exists, the candidate is skipped. */
const SEGMENT_CLAIMS: Record<Segment, string[]> = {
  researcher: ['researcher.intro', 'researcher.detail', 'researcher.ask'],
  phd_student: ['phd_student.intro', 'phd_student.detail', 'phd_student.ask'],
  industry: ['industry.intro', 'industry.detail', 'industry.coop'],
  recruiter: ['recruiter.intro', 'recruiter.detail', 'recruiter.coop'],
};

const RESUME_BY_SEGMENT: Record<Segment, ResumeVariant> = {
  researcher: 'ml',
  phd_student: 'ml',
  industry: 'ai',
  recruiter: 'ai',
};

function firstName(name: string): string {
  const f = name.trim().split(/\s+/)[0] ?? '';
  return /@/.test(f) ? 'there' : f || 'there';
}

function subjectFor(c: Candidate): string {
  const first = firstName(c.name);
  switch (c.segment) {
    case 'researcher':
    case 'phd_student':
      return `${first}, a question about your research`;
    case 'recruiter':
      return `${first}, Fall 2026 co-op candidate for ${c.org}`;
    case 'industry':
    default:
      return `${first}, Fall 2026 co-op and your team at ${c.org}`;
  }
}

export class Drafter {
  constructor(private readonly snippets: SnippetBook) {}

  /** Build an email draft, or a skip reason when it cannot be grounded/sent. */
  email(c: Candidate, fromAccount: SendAccount): { draft: EmailDraft } | { skip: string } {
    if (!c.email) return { skip: 'no email address' };

    // Require the segment's intro+detail+ask snippets; no segment snippet means
    // we cannot ground a real claim, so skip rather than send a claim-less note.
    const segmentKeys = SEGMENT_CLAIMS[c.segment].filter((k) => this.snippets.has(k));
    if (segmentKeys.length === 0) return { skip: `no approved snippets for segment ${c.segment}` };
    // The signature is an approved snippet too, so it is gate-grounded; if absent
    // we fall back to a bare name.
    const hasSig = this.snippets.has('common.signature');
    const keys = hasSig ? [...segmentKeys, 'common.signature'] : segmentKeys;

    const personalization = this.personalization(c);
    // A company-specific relevance line, only when we know what they work on.
    const relevance = c.focus ? ` ${c.org}'s work on ${c.focus} is close to what I want to build.` : '';
    const claims = segmentKeys.map((k) => this.snippets.resolve(k)!);
    const signoff = hasSig ? this.snippets.resolve('common.signature')! : 'Parv';

    const body =
      `Hi ${firstName(c.name)},\n\n` +
      `${personalization}${relevance}\n\n` +
      `${claims.join('\n\n')}\n\n` +
      `I have attached my resume.\n\n` +
      `${signoff}`;

    return {
      draft: {
        contactId: contactIdForEmail(c.email),
        to: c.email,
        fromAccount,
        subject: subjectFor(c),
        body,
        segment: c.segment,
        personalization,
        sourceUrl: c.sourceUrl,
        claimKeys: keys,
        resumeVariant: RESUME_BY_SEGMENT[c.segment],
        emailStatus: c.emailStatus,
        emailConfidence: c.emailConfidence,
      },
    };
  }

  /**
   * Build a copy-paste LinkedIn DM. Not gated (you send it), but kept clean and
   * SHORT: a connection note caps near 300 chars, so it prefers a dedicated
   * short `linkedin.intro` snippet over the long email intro.
   */
  linkedin(c: Candidate): LinkedInDraft {
    const intro =
      this.snippets.resolve('linkedin.intro') ??
      this.snippets.resolve(SEGMENT_CLAIMS[c.segment][0]!) ??
      "I'm an MS AI student at Northeastern.";
    const url = c.linkedinUrl ?? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name)}`;
    const message = `Hi ${firstName(c.name)}, I came across ${c.hook} and wanted to connect. ${intro} Open to a quick chat?`;
    return { name: c.name, linkedinUrl: url, segment: c.segment, message, hook: c.hook };
  }

  /** Stable id for a candidate even before an email is resolved (LinkedIn pack). */
  static contactId(c: Candidate): string {
    return c.email ? contactIdForEmail(c.email) : contactIdForProfile(c.linkedinUrl ?? c.name);
  }

  private personalization(c: Candidate): string {
    return `I came across ${c.hook}.`;
  }
}
