/**
 * One-shot migration: v1 data/applications.json -> append-only event log.
 * Idempotent: an appId already present in the log (or seen earlier in the
 * same run, i.e. v1 duplicate rows) is skipped, never re-emitted.
 *
 * CLI: npm run migrate  (alias for: tsx scripts/migrate-legacy.ts)
 */

import fs from 'fs';
import { pathToFileURL } from 'url';
import { EventStore } from '../src/store/EventStore.js';
import { ViewWriter } from '../src/store/ViewWriter.js';
import { appIdFor, SUBMITTED_STATUSES, TERMINAL_STATUSES } from '../src/store/events.js';
import type { AppendInput } from '../src/store/EventStore.js';
import type { Application } from '../src/types.js';

export interface MigrationResult {
  migrated: number;
  skipped: number;
}

export function migrateLegacy(records: Application[], store: EventStore): MigrationResult {
  const proj = store.projection();
  const seen = new Set<string>();
  let migrated = 0;
  let skipped = 0;

  for (const rec of records) {
    const appId = appIdFor(rec.company, rec.role);
    if (seen.has(appId) || proj.has(appId)) {
      skipped++;
      continue;
    }
    seen.add(appId);

    const events: AppendInput[] = [
      {
        type: 'discovered',
        appId,
        payload: { legacy: true, company: rec.company, role: rec.role, url: rec.url },
      },
      { type: 'queued', appId, payload: { legacy: true, application: rec } },
    ];
    if (SUBMITTED_STATUSES.has(rec.status)) {
      events.push({
        type: 'submitted',
        appId,
        payload: { legacy: true, appliedAt: rec.appliedAt ?? rec.date },
      });
    }
    if (TERMINAL_STATUSES.has(rec.status)) {
      events.push({ type: 'closed', appId, payload: { legacy: true, status: rec.status } });
    }

    for (const e of events) store.append(e);
    migrated++;
  }

  return { migrated, skipped };
}

function main(): void {
  const legacyPath = 'data/applications.json';
  const backupPath = 'data/applications.legacy.json';

  if (!fs.existsSync(legacyPath)) {
    console.error(`No ${legacyPath} found; nothing to migrate.`);
    process.exit(1);
  }
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(legacyPath, backupPath);
    console.log(`Backed up ${legacyPath} -> ${backupPath}`);
  }

  const records = JSON.parse(fs.readFileSync(legacyPath, 'utf8')) as Application[];
  const store = new EventStore('data/events.jsonl');
  const result = migrateLegacy(records, store);

  const proj = store.projection();
  new ViewWriter().write(proj, legacyPath);

  console.log(`Migrated: ${result.migrated}, skipped (duplicates/already migrated): ${result.skipped}`);
  console.log(`Projection now holds ${proj.all().length} applications. Status counts:`);
  console.log(JSON.stringify(proj.counts(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
