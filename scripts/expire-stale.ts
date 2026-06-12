/**
 * Closes Ready queue entries older than maxDays (default 14).
 * Parv's rule, 2026-06-12: never apply to anything older than 2 weeks.
 * The queue date is the proxy for age: a job queued 30 days ago is at
 * least 30 days old. Unknown dates close too: unprovably fresh is stale.
 *
 * CLI: npm run expire   (tsx scripts/expire-stale.ts [maxDays])
 */

import { pathToFileURL } from 'url';
import { ApplicationStore } from '../src/tracker/ApplicationStore.js';

const MS_PER_DAY = 86_400_000;

export function expireStale(store: ApplicationStore, nowMs: number, maxDays = 14): string[] {
  const closed: string[] = [];
  for (const app of store.getByStatus('Ready')) {
    const queuedMs = Date.parse(app.date);
    if (Number.isNaN(queuedMs) || (nowMs - queuedMs) / MS_PER_DAY > maxDays) {
      store.update(app.id, { status: 'Closed' });
      closed.push(app.id);
    }
  }
  return closed;
}

function main(): void {
  const maxDays = Number(process.argv[2] ?? '14');
  const store = new ApplicationStore();
  const before = store.getByStatus('Ready').length;
  const closed = expireStale(store, Date.now(), maxDays);
  console.log(`Ready before: ${before} | expired (> ${maxDays}d): ${closed.length} | Ready now: ${before - closed.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
