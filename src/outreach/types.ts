/** Shared types for the outreach engine (cold email + LinkedIn). One place. */

import type { ResumeVariant } from '../types.js';

/** Who we are reaching out to. Drives sender identity, snippet pool, resume variant. */
export type Segment = 'researcher' | 'phd_student' | 'industry' | 'recruiter';

export const SEGMENTS: readonly Segment[] = ['researcher', 'phd_student', 'industry', 'recruiter'];

/** Which authenticated account a draft sends from. */
export type SendAccount = 'gmail' | 'outlook';

/**
 * Hunter email-verifier status (v2). `valid` is the only status the auto-send
 * gate accepts; everything else routes a draft to human review so a bounce can
 * never hit Parv's sender reputation.
 */
export type HunterStatus = 'valid' | 'invalid' | 'accept_all' | 'webmail' | 'disposable' | 'unknown';

/** A person sourced for outreach, with the evidence that found them. */
export interface Candidate {
  name: string;
  segment: Segment;
  org: string; // company, university, or lab
  role?: string; // title / position
  email?: string; // resolved address (may be absent for LinkedIn-only contacts)
  emailConfidence?: number; // 0-100 from Hunter
  emailStatus?: HunterStatus;
  linkedinUrl?: string;
  /** Where we found this person. Required: every claim about the recipient is evidenced. */
  sourceUrl: string;
  /** The specific personalization fact (a paper title, a project, a talk). */
  hook: string;
  /** What the org works on (e.g. "humanoid robots"), used for a relevance line. */
  focus?: string;
}

/** A cold-email draft, the unit the DraftGate verifies and the Mailer sends. */
export interface EmailDraft {
  contactId: string;
  to: string;
  fromAccount: SendAccount;
  subject: string;
  body: string;
  segment: Segment;
  resumeVariant?: ResumeVariant;
  /** The line that references the recipient specifically. The gate requires it to be non-empty. */
  personalization: string;
  /** Evidence URL backing the recipient facts in the draft. */
  sourceUrl: string;
  /** Snippet keys for the self-claims used; each must resolve to an approved snippet. */
  claimKeys: string[];
  emailStatus?: HunterStatus;
  emailConfidence?: number;
}

/** A LinkedIn DM draft. No automation: Parv pastes and sends it himself. */
export interface LinkedInDraft {
  name: string;
  linkedinUrl: string;
  segment: Segment;
  message: string;
  hook: string;
}

/** Outcome of running a draft through the auto-send gate. */
export type GateOutcome =
  | { decision: 'send'; draft: EmailDraft }
  | { decision: 'abstain'; draft: EmailDraft; reasons: string[] };
