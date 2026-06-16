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
