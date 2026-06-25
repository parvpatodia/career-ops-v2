/**
 * SWEList / NewGrad list tables use "↳" in the COMPANY cell to mean "same
 * company as the row above": a company with multiple roles is named once, then
 * its extra roles continue on following rows with ↳ in the company column.
 *
 * Recording "↳" literally as the company is a real defect, not cosmetic:
 *   1. the tracker/queue shows "↳" instead of the employer, and
 *   2. it COLLIDES idempotency — appIdFor("↳", role) is shared by every
 *      unrelated company whose continuation role has that same common title
 *      (e.g. "Software Engineer 1"), so the second real job is dropped as a
 *      false duplicate (AGENTS.md invariant 3).
 *
 * resolveContinuationCompany inherits the last real company on a ↳ row, tracked
 * in document order. Pure, so the rule is unit-tested without fetching a list.
 */

export interface CompanyResolution {
  /** The resolved company, or null when the row must be skipped (no parent / empty). */
  company: string | null;
  /** The company to carry forward as the parent for the following ↳ rows. */
  lastCompany: string;
}

export function resolveContinuationCompany(parsed: string, lastCompany: string): CompanyResolution {
  if (parsed === '↳') {
    // Continuation row: inherit the previous real company. With no parent seen
    // yet we cannot attribute it, so skip (never guess a company onto a job).
    return { company: lastCompany || null, lastCompany };
  }
  if (!parsed) return { company: null, lastCompany };
  return { company: parsed, lastCompany: parsed };
}
