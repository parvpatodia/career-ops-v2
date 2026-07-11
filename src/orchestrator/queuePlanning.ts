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

// Titles that NAME a discipline outside Parv's field. A title is the reliable
// signal of the ROLE (the JD is noisy with company context — an "Aerodynamics
// Intern" at an autonomous-drone company has a JD full of "autonomous"/"software"
// that describes the COMPANY, not the role). So an off-field TITLE is penalized
// regardless of JD. On-field title patterns (RELEVANT_ROLE_PATTERNS) are checked
// FIRST, so "Manufacturing Software Engineer" stays on-field.
export const OFF_FIELD_TITLE_PATTERNS: readonly RegExp[] = [
  /\baero(dynamic|space|nautical)/i, /\bmechanical\b/i, /\belectrical\b/i, /\bcivil\b/i,
  /\bchemical\b/i, /\bstructural\b/i, /\bthermal\b/i, /\bmaterials\b/i, /\bmanufacturing engineer/i,
  /\bindustrial engineer/i, /\bquality engineer/i,
  /\baccount(ing|ant)\b/i, /\bfinance\b/i, /\bfinancial analyst\b/i, /\btax\b/i, /\baudit/i,
  /\bmarketing\b/i, /\bsales\b/i, /\brecruit/i, /\bhuman resources\b/i, /\btalent\b/i,
  /\blegal\b/i, /\battorney\b/i, /\bparalegal\b/i,
  /\bclinical\b/i, /\bnurs(e|ing)\b/i, /\bbiolog/i, /\bchemist/i,
  /\bcommunications\b/i, /\bgraphic design\b/i, /\bindustrial design\b/i,
  /\bsupply chain\b/i, /\blogistics\b/i, /\boperations\b/i,
];

/**
 * Role-fit MULTIPLIER for the score (scorer calibration): the ROLE must matter
 * more than "fresh intern at a hot company". Title-primary, since the title names
 * the role's field while the JD is noisy with company context:
 *   - on-field TITLE (RELEVANT_ROLE_PATTERNS)         -> 1.0 (wins outright)
 *   - off-field TITLE (names another discipline)      -> 0.35 (JD cannot rescue;
 *       its field words are company context, not the role)
 *   - neutral title -> fall back to the JD: >=2 field signals -> 1.0,
 *       exactly 1 -> 0.7, none -> 0.35
 * The 0.35 floor drops an off-field role below the apply threshold even when
 * experience/location/timing are all maxed. Pure, so it is unit-tested. WHY a
 * multiplier (not a 7th weighted term): it cannot be diluted by the other
 * factors — a fresh posting at a famous company cannot float an off-field role.
 */
export function roleRelevance(title: string, jd: string): number {
  const t = title ?? '';
  if (isRelevantRole(t)) return 1.0;                                  // on-field title wins
  if (OFF_FIELD_TITLE_PATTERNS.some((p) => p.test(t))) return 0.35;   // names a non-Parv discipline
  const jdHits = RELEVANT_ROLE_PATTERNS.filter((p) => p.test(jd ?? '')).length; // neutral -> use JD
  if (jdHits >= 2) return 1.0;
  if (jdHits === 1) return 0.7;
  return 0.35;
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
