/**
 * Candidate selection for the daily plan: dedup, suppression, and the per-channel
 * cap. Extracted from the plan CLI and unit-tested because this exact logic
 * shipped a real bug once (a filter().slice() that marked every inspected
 * candidate `seen` before the slice, dropping over-cap contacts from BOTH the
 * email and the LinkedIn pass). LESSONS 2026-06-16: pull CLI logic into a pure,
 * tested module, that is how these surface.
 */

import { Drafter } from './Drafter.js';
import type { Candidate } from './types.js';

export interface PickFreshOptions {
  /** Max candidates to return. */
  limit: number;
  /** Require a resolved email (email batch); the LinkedIn pool does not. */
  needEmail: boolean;
  /**
   * Ids already chosen this run. MUTATED: the ids of returned candidates are
   * added. Share one set across the email and LinkedIn passes so a contact is
   * never used on both channels in the same run.
   */
  seen: Set<string>;
  /** True if the contact was already sent/replied/bounced/opted-out. */
  isSuppressed: (contactId: string) => boolean;
  /** Cap how many picks share the same `org`, so a batch spans several companies
   *  instead of emptying one. Omit for no per-org limit. */
  maxPerOrg?: number;
  /** Stable contact id. Defaults to Drafter.contactId (email key, else profile). */
  idOf?: (c: Candidate) => string;
}

/**
 * Return up to `limit` fresh candidates, marking `seen` ONLY for the ones kept.
 * WHY a capped loop, not filter().slice(): a seen-mutating filter marks every
 * candidate it inspects before the slice, so contacts past the cap get flagged
 * seen and then dropped from a later pass too. Marking only the kept ones leaves
 * the rest available for the next pass.
 */
export function pickFresh(pool: readonly Candidate[], opts: PickFreshOptions): Candidate[] {
  const idOf = opts.idOf ?? Drafter.contactId;
  const picked: Candidate[] = [];
  const perOrg = new Map<string, number>();
  for (const c of pool) {
    if (picked.length >= opts.limit) break;
    if (opts.needEmail && !c.email) continue;
    const id = idOf(c);
    if (opts.seen.has(id) || opts.isSuppressed(id)) continue;
    if (opts.maxPerOrg !== undefined) {
      const used = perOrg.get(c.org) ?? 0;
      if (used >= opts.maxPerOrg) continue; // org quota reached; leave them unmarked for another day
      perOrg.set(c.org, used + 1);
    }
    opts.seen.add(id);
    picked.push(c);
  }
  return picked;
}
