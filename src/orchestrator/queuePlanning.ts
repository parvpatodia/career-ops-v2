/**
 * Pure helpers the `run` CLI uses to turn the queue into apply work: the F-1
 * eligibility gate and the Application -> Job/EvaluationResult reconstruction a
 * re-tailor needs. Kept pure (no IO) so the safety-critical logic is unit-tested
 * without a store, profile, or browser.
 */

import type { Application, Job, EvaluationResult, Platform } from '../types.js';

// F-1 visa cannot qualify for US-Person roles (ITAR, security clearances, etc.).
// The gate runs before any browser opens; a matched role is skipped, never filled.
export const INELIGIBLE_KEYWORDS = [
  'us citizen', 'u.s. citizen', 'united states citizen',
  'security clearance', 'secret clearance', 'top secret', 'ts/sci',
  'itar', 'ear compliance', 'us person', 'u.s. person', 'export control',
];

export function isIneligible(app: Application): boolean {
  const haystack = `${app.role} ${app.company} ${app.notes ?? ''}`.toLowerCase();
  return INELIGIBLE_KEYWORDS.some((kw) => haystack.includes(kw));
}

// The roles Parv targets (his degree + projects): AI / ML / software / robotics /
// autonomy / physical intelligence. Matched by WORD-BOUNDARY patterns so short
// tokens cannot false-match ( \bai\b never matches "training"/"email"/"retail" ).
// The watcher and sourcing use this so alerts + the queue stay on-field: the ROLE
// matters, not the company (a Marketing/Accounting/Aerodynamics intern is dropped).
export const RELEVANT_ROLE_PATTERNS: readonly RegExp[] = [
  /\bmachine learning\b/i, /\bml\b/i, /\bmlops\b/i,
  /\bai\b/i, /\bartificial intelligence\b/i, /\bdeep learning\b/i,
  /\breinforcement learning\b/i, /\bgenerative\b/i, /\bfoundation model/i, /\bllm\b/i,
  /\bsoftware engineer/i, /\bsoftware develop/i, /\bswe\b/i, /\bsde\b/i,
  /\b(?:ml|ai) engineer/i, /\bresearch engineer/i, /\bresearch scientist/i, /\bapplied scientist/i,
  /\brobotics?\b/i, /\bperception\b/i, /\bautonomous\b/i, /\bautonomy\b/i, /\bself[ -]?driving\b/i,
  /\bcomputer vision\b/i, /\bnlp\b/i, /\bnatural language\b/i,
  /\bdata scientist/i, /\bdata engineer/i,
  /\bphysical intelligence\b/i, /\bembodied\b/i, /\bmotion planning\b/i,
];

/** True when the job TITLE is in Parv's field (AI/ML/SWE/robotics/AV/...). */
export function isRelevantRole(title: string): boolean {
  return RELEVANT_ROLE_PATTERNS.some((p) => p.test(title ?? ''));
}

/** What the read-only preflight observes about one scanned form. */
export interface TriageInput {
  hasCaptcha: boolean;
  /** Required fields whose widget the mapper cannot fill safely. */
  requiredUnmapped: number;
  /** Required/needs-review questions with no approved answer (the gate abstains). */
  unknownQuestions: number;
  /** Fields the payload would fill (gated, confident). */
  fillableFields: number;
}

export interface TriageVerdict {
  /** 'auto': predicted hands-off submittable via --approve. 'attended': needs you. */
  mode: 'auto' | 'attended';
  reasons: string[];
}

/**
 * Predict whether a form can go hands-off. A form is AUTO only when nothing
 * needs a human: no captcha, no required widget the filler can't map, no unknown
 * question, and at least one field actually fills (an empty payload abstains).
 * Pure (no IO) so the routing is unit-tested; --approve still INDEPENDENTLY
 * verifies before it ever submits, so a wrong "auto" guess cannot cause a bad
 * submission — it would just verify_failed or abstain at run time.
 */
export function triageForm(input: TriageInput): TriageVerdict {
  const reasons: string[] = [];
  if (input.hasCaptcha) reasons.push('captcha present (you solve it)');
  if (input.requiredUnmapped > 0) reasons.push(`${input.requiredUnmapped} required field(s) the filler can't map safely`);
  if (input.unknownQuestions > 0) reasons.push(`${input.unknownQuestions} unknown question(s) with no approved answer`);
  if (input.fillableFields === 0) reasons.push('no fillable fields detected');
  return { mode: reasons.length === 0 ? 'auto' : 'attended', reasons };
}

export function parseNotes(notes: string): { platform: Platform; location: string } {
  const parts = (notes ?? '').split(' | ');
  // `||` not `??`: an empty/blank platform token must fall back to 'direct'
  // (an empty string is not nullish, so `??` would keep it).
  return { platform: ((parts[0]?.trim() || 'direct')) as Platform, location: parts[1]?.trim() ?? '' };
}

/** Reconstruct the Job + EvaluationResult a re-tailor needs from a queued app. */
export function jobFromApp(app: Application): { job: Job; evaluation: EvaluationResult } {
  const { platform, location } = parseNotes(app.notes);
  const job: Job = {
    id: app.jobId,
    title: app.role,
    company: app.company,
    url: app.url,
    applyUrl: app.url,
    platform,
    location,
    remote: location.toLowerCase().includes('remote'),
    postedAt: app.date,
    discoveredAt: app.date,
    jd: app.jd ?? '',
    status: 'evaluated',
  };
  const evaluation: EvaluationResult = {
    jobId: app.jobId,
    score: app.score,
    breakdown: { skillMatch: 0, experienceMatch: 0, locationMatch: 0, visaMatch: 0, companySignal: 0, timingMatch: 0 },
    reasoning: '(re-tailor from queue)',
    resumeVariant: app.resumeVariant,
    topMatchingSkills: [],
    missingSkills: [],
    shouldApply: true,
    // Cover-letter generation needs per-job paragraphs we do not synthesize here;
    // the resume (the ATS-critical artifact) is always tailored + verified.
    shouldGenerateCoverLetter: false,
    evaluatedAt: app.date,
  };
  return { job, evaluation };
}
