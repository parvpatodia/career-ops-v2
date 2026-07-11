/**
 * The heart of the "be first to apply" watcher (Tsenta-parity, free): given the
 * latest fresh scan and the set of job ids we have already seen, return the
 * genuinely-NEW postings to alert on, plus the updated seen-set.
 *
 * WHY first-run seeding: on the very first watch, EVERY job on the board is
 * "new to us". Alerting on hundreds of existing postings would be noise, not
 * signal — the point is to catch postings that appear AFTER we start watching.
 * So an empty seen-set seeds silently (fresh = []), and only later deltas alert.
 *
 * Pure (no IO): the watcher does the scanning, notifying, and persistence; this
 * decides WHAT is new, so the decision is unit-tested without a network or disk.
 */

import type { Job } from '../types.js';

export interface DetectResult {
  /** Genuinely-new postings to alert on (empty on the first run). */
  fresh: Job[];
  /** The seen-set to persist for next time (previous seen ∪ everything now on the board). */
  nextSeen: string[];
  /** True when there was no prior seen-set (seeded silently, no alerts). */
  firstRun: boolean;
}

export function detectNewPostings(scanned: Job[], seenIds: readonly string[]): DetectResult {
  const seen = new Set(seenIds);
  // Dedup scanned ids (the same job can surface from more than one source).
  const scannedIds = scanned.map((j) => j.id);
  const nextSeen = Array.from(new Set([...seenIds, ...scannedIds]));

  if (seen.size === 0) {
    return { fresh: [], nextSeen, firstRun: true };
  }

  // De-dup the delta by id too, so one alert per new posting even if two
  // sources surfaced it this cycle.
  const emitted = new Set<string>();
  const fresh: Job[] = [];
  for (const job of scanned) {
    if (seen.has(job.id) || emitted.has(job.id)) continue;
    emitted.add(job.id);
    fresh.push(job);
  }
  return { fresh, nextSeen, firstRun: false };
}
