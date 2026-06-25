/**
 * Hunter credit pre-flight. WHY this exists: on the free plan, when monthly
 * searches run out, every domain-search fails and the email half silently drops
 * to zero while the daily loop still "succeeds" on the arXiv LinkedIn pack. Parv
 * would think outreach is running when the email side has quietly stopped. This
 * turns that silent degradation into a visible signal. Pure and tested; the plan
 * CLI calls it and notifies on a non-ok result.
 */

import type { AccountQuota } from './HunterClient.js';

export type BudgetLevel = 'ok' | 'low' | 'exhausted';

export interface HunterBudgetStatus {
  level: BudgetLevel;
  remainingSearches: number;
  remainingVerifications: number;
  message: string;
}

export function assessHunterBudget(
  acct: AccountQuota,
  plannedSearches: number,
  plannedVerifications: number
): HunterBudgetStatus {
  const remainingSearches = Math.max(0, acct.searchesAvailable - acct.searchesUsed);
  const remainingVerifications = Math.max(0, acct.verificationsAvailable - acct.verificationsUsed);

  let level: BudgetLevel = 'ok';
  if (remainingSearches <= 0) level = 'exhausted';
  else if (remainingSearches < plannedSearches || remainingVerifications < plannedVerifications) level = 'low';

  const message =
    level === 'exhausted'
      ? `Hunter searches exhausted (0 left): no new company emails until the plan resets. The arXiv LinkedIn pack still runs. Upgrade Hunter or wait for the monthly reset.`
      : level === 'low'
        ? `Hunter credits low: ${remainingSearches} search(es) and ${remainingVerifications} verification(s) left, but this run wants ${plannedSearches}/${plannedVerifications}. Some company contacts will be skipped.`
        : `Hunter ok: ${remainingSearches} searches, ${remainingVerifications} verifications left.`;

  return { level, remainingSearches, remainingVerifications, message };
}
