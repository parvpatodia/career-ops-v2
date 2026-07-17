/**
 * Hard freshness gate: no application to postings older than maxDays
 * (default 14). Parv's rule, 2026-06-12: "no older applications than 2
 * weeks", no exceptions. The previous 60-day big-company exception is
 * deliberately removed.
 *
 * WHY an `unknown` bucket: a date the system cannot parse must surface as
 * a data-quality problem, not silently pass or silently vanish. Scanners
 * that fake postedAt get caught here.
 */

import type { Job } from '../types.js';

/** The hard freshness window in days (Parv 2026-06-12: no posting older than 2
 *  weeks). Exported so any read boundary that surfaces posting age uses the SAME
 *  cutoff as the apply gate, never a duplicated literal. */
export const FRESHNESS_MAX_DAYS = 14;
const DEFAULT_MAX_DAYS = FRESHNESS_MAX_DAYS;
const MS_PER_DAY = 86_400_000;

export interface FreshnessResult {
  fresh: Job[];
  stale: Job[];
  /** postedAt missing or unparseable: treated as not fresh, reported separately. */
  unknown: Job[];
}

export class FreshnessFilter {
  constructor(private readonly maxDays: number = DEFAULT_MAX_DAYS) {}

  filter(jobs: Job[], nowMs: number = Date.now()): FreshnessResult {
    const fresh: Job[] = [];
    const stale: Job[] = [];
    const unknown: Job[] = [];

    for (const job of jobs) {
      const postedMs = Date.parse(job.postedAt ?? '');
      if (Number.isNaN(postedMs)) {
        unknown.push(job);
        continue;
      }
      const ageDays = (nowMs - postedMs) / MS_PER_DAY;
      if (ageDays <= this.maxDays) fresh.push(job);
      else stale.push(job);
    }

    return { fresh, stale, unknown };
  }
}
