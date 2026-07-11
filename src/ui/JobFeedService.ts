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

export interface FreshRole {
  id: string;
  company: string;
  role: string;
  applyUrl: string;
  platform: string;
  postedAt: string;
  caughtAt: string;
}

export interface QueueRole {
  id: string;
  company: string;
  role: string;
  url: string;
  score: number;
}

export interface FeedSnapshot {
  fresh: FreshRole[];
  counts: Record<string, number>;
  ready: QueueRole[];
  generatedAt: string;
}

export class JobFeedService {
  constructor(
    private readonly store: ApplicationStore,
    private readonly hotlistPath = 'data/new-jobs.json'
  ) {}

  /** The watcher's hot-list of freshly-caught on-field roles (newest first). */
  fresh(limit = 50): FreshRole[] {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.hotlistPath, 'utf8'));
    } catch {
      return []; // no watcher output yet is a normal empty state, not an error
    }
    if (!Array.isArray(raw)) return [];
    return (raw as FreshRole[]).slice(0, limit);
  }

  /** A full snapshot for one UI poll: fresh roles + queue counts + the Ready list. */
  snapshot(): FeedSnapshot {
    this.store.load(); // re-read the event-log view so the UI is never stale
    const all = this.store.getAll();
    const counts: Record<string, number> = {};
    for (const a of all) counts[a.status] = (counts[a.status] ?? 0) + 1;

    const ready: QueueRole[] = this.store
      .getByStatus('Ready')
      .map((a) => ({ id: a.id, company: a.company, role: a.role, url: a.url, score: a.score }))
      .sort((x, y) => y.score - x.score);

    return { fresh: this.fresh(), counts, ready, generatedAt: new Date().toISOString() };
  }
}
