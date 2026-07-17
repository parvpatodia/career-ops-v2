/**
 * Read model for the local UI. Composes the two things a user acts on:
 *   - the watcher's hot-list of freshly-caught, on-field roles (data/new-jobs.json)
 *   - the application queue (Ready / Applied / ...) from the single event log
 *
 * Pure read layer: it never mutates state (the UI is a view + launcher, applying
 * still goes through `npm run run -- --auto`). Injectable store + hot-list path so
 * it is unit-tested without a server or real data.
 */

import fs from 'fs';
import type { ApplicationStore } from '../tracker/ApplicationStore.js';
import { isRelevantRole, INELIGIBLE_KEYWORDS } from '../orchestrator/queuePlanning.js';
import { isLikelyNonUS } from '../utils/locations.js';
import { categorize } from '../scanner/categorize.js';
import { FRESHNESS_MAX_DAYS } from '../pipeline/FreshnessFilter.js';

export interface FreshRole {
  id: string;
  company: string;
  role: string;
  applyUrl: string;
  platform: string;
  postedAt: string;
  caughtAt: string;
  /** Coarse bucket for UI grouping; older hot-list entries may lack it. */
  category?: string;
  location?: string;
  /** Real posting age + days until the 14-day freshness cutoff. Null when the
   *  posting date is unknown or only a proxy (email digests carry the received
   *  time, not the posting date), so the UI never shows a misleading age. */
  freshness?: { postedAgeDays: number; expiresInDays: number } | null;
}

export interface QueueRole {
  id: string;
  company: string;
  role: string;
  url: string;
  score: number;
}

export interface AppliedRole {
  id: string;
  company: string;
  role: string;
  url: string;
  appliedAt: string;
}

export interface FeedSnapshot {
  fresh: FreshRole[];
  counts: Record<string, number>;
  ready: QueueRole[];
  applied: AppliedRole[];
  generatedAt: string;
}

export class JobFeedService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly hotlistPath = 'data/new-jobs.json'
  ) {}

  /**
   * The watcher's hot-list of freshly-caught on-field roles (newest first).
   * Re-applies the correctness gates at the READ boundary so the UI can never
   * show an off-field, non-US, F-1-ineligible, or long-stale role — even if a
   * stale/leaked entry sits in the hot-list file from an older watcher build or
   * an ingestion gap. This is the single choke point before the UI.
   */
  fresh(limit = 50): FreshRole[] {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.hotlistPath, 'utf8'));
    } catch {
      return []; // no watcher output yet is a normal empty state, not an error
    }
    if (!Array.isArray(raw)) return [];
    return (raw as FreshRole[])
      .filter((j) => this.isCorrect(j))
      // Recompute category from the role at read time: older hot-list entries
      // predate category tagging (would show as "Other"), and this keeps the UI
      // consistent with the current categorize() regardless of what was stored.
      // Also attach real posting freshness so the UI can flag roles nearing the
      // 14-day cutoff (proactivity), not just when WE caught them.
      .map((j) => ({ ...j, category: categorize(j.role ?? ''), freshness: this.postingFreshness(j) }))
      .slice(0, limit);
  }

  /**
   * Real posting age + days left before the freshness cutoff. Null when unknown:
   * an email digest's postedAt is its RECEIVED time (not the posting date), which
   * would under-report age and make a stale role look fresh, and a board role with
   * an unparseable date has no trustworthy age. The apply gate (FreshnessFilter)
   * remains the hard enforcement; this is the surfaced signal for the launcher UI.
   */
  private postingFreshness(j: FreshRole): { postedAgeDays: number; expiresInDays: number } | null {
    if ((j.platform ?? '').startsWith('email:')) return null;
    const postedMs = Date.parse(j.postedAt ?? '');
    if (Number.isNaN(postedMs)) return null;
    const ageDays = Math.max(0, Math.floor((Date.now() - postedMs) / 86_400_000));
    return { postedAgeDays: ageDays, expiresInDays: FRESHNESS_MAX_DAYS - ageDays };
  }

  /** Correctness gate: on-field role, US, F-1-eligible, not long-stale in the list. */
  private isCorrect(j: FreshRole): boolean {
    const role = j.role ?? '';
    const hay = `${role} ${j.company ?? ''} ${j.location ?? ''}`.toLowerCase();
    if (!isRelevantRole(role)) return false;
    if (INELIGIBLE_KEYWORDS.some((k) => hay.includes(k))) return false;
    if (isLikelyNonUS(`${role} ${j.location ?? ''}`)) return false;
    // caughtAt is when WE caught it; posting-date freshness is enforced upstream
    // at scan. Drop anything lingering in the list far past the 14-day window.
    const caughtMs = Date.parse(j.caughtAt ?? '');
    if (!Number.isNaN(caughtMs) && (Date.now() - caughtMs) / 86_400_000 > 21) return false;
    return true;
  }

  /** Applied roles, most recently applied first (the "move to applied" section). */
  applied(limit = 100): AppliedRole[] {
    return this.store
      .getByStatus('Applied')
      .map((a) => ({
        id: a.id,
        company: a.company,
        role: a.role,
        url: a.url,
        appliedAt: a.appliedAt ?? a.tailoredAt ?? a.date ?? '',
      }))
      .sort((x, y) => (y.appliedAt ?? '').localeCompare(x.appliedAt ?? ''))
      .slice(0, limit);
  }

  /** A full snapshot for one UI poll: fresh roles + queue counts + Ready + Applied. */
  snapshot(): FeedSnapshot {
    this.store.load(); // re-read the event-log view so the UI is never stale
    const all = this.store.getAll();
    const counts: Record<string, number> = {};
    for (const a of all) counts[a.status] = (counts[a.status] ?? 0) + 1;

    const ready: QueueRole[] = this.store
      .getByStatus('Ready')
      .map((a) => ({ id: a.id, company: a.company, role: a.role, url: a.url, score: a.score }))
      .sort((x, y) => y.score - x.score);

    return { fresh: this.fresh(), counts, ready, applied: this.applied(), generatedAt: new Date().toISOString() };
  }
}
