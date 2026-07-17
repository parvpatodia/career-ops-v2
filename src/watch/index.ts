/**
 * `npm run watch` — the "be first to apply" watcher (Tsenta-parity, free).
 *
 * Scans the FAST, no-auth, no-browser sources (Greenhouse / Lever / Ashby board
 * APIs, plus the SWEList/NewGrad lists) on every run, diffs against a persisted
 * seen-set, and fires an INSTANT desktop notification for each genuinely-NEW,
 * F-1-eligible posting with its apply link — so Parv applies among the first
 * (applications are first-come-first-served; speed is the edge). New postings
 * are also appended to data/new-jobs.json (a hot-list to act on).
 *
 * Run it on a fast cadence via launchd (see scripts/watch-loop.sh) to get
 * near-real-time alerts. It NEVER applies or submits anything — it only watches
 * and alerts; applying stays the human/captcha step (`npm run run -- --auto`).
 *
 * WHY scanFresh (not scanWithCache): the daily cache would hide jobs posted
 * later the same day, defeating the whole point. WHY first-run seeds silently:
 * see detectNewPostings — alerting on the entire existing board is noise.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import type { Job, ScanQuery } from '../types.js';
import type { Scanner } from '../scanner/Scanner.js';
import { GreenhouseBoardScanner } from '../scanner/GreenhouseBoardScanner.js';
import { LeverBoardScanner } from '../scanner/LeverBoardScanner.js';
import { AshbyBoardScanner } from '../scanner/AshbyBoardScanner.js';
import { SWEListScanner } from '../scanner/SWEListScanner.js';
import { NewGradScanner } from '../scanner/NewGradScanner.js';
import { detectNewPostings } from './detectNewPostings.js';
import { enrichHotlist } from './enrichHotlist.js';
import { INELIGIBLE_KEYWORDS, isRelevantRole } from '../orchestrator/queuePlanning.js';
import { categorize } from '../scanner/categorize.js';
import { Notifier } from '../applier/Notifier.js';
import { Logger } from '../utils/Logger.js';

const log = new Logger('watch');
const SEEN_PATH = 'data/watch-seen.json';
const HOTLIST_PATH = 'data/new-jobs.json';
const HOTLIST_CAP = 200;      // keep the last N new postings
const NOTIFY_CAP = 12;        // never fire more than this many banners in one cycle
const QUERY: ScanQuery = {
  postedWithinDays: 14,
  keywords: [
    'intern', 'internship', 'co-op', 'coop', 'new grad',
    'machine learning', 'ml', 'ai', 'artificial intelligence', 'deep learning',
    'robotics', 'perception', 'autonomous', 'software engineer', 'data scientist',
  ],
};

/** F-1 cannot hold US-Person/clearance roles; do not alert on them. */
function eligible(job: Job): boolean {
  const hay = `${job.title} ${job.company} ${job.jd ?? ''}`.toLowerCase();
  return !INELIGIBLE_KEYWORDS.some((kw) => hay.includes(kw));
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

async function main(): Promise<void> {
  // The fast, no-auth, no-browser sources — the ones that see a posting the
  // moment the company publishes it. Auth/browser scanners are excluded.
  const scanners: Array<[string, () => Scanner]> = [
    // JD cache on: the 60s loop fetches each Greenhouse posting's JD once, ever
    // (the detail call is the only one that scales with matches, not boards).
    ['greenhouse', () => GreenhouseBoardScanner.fromConfig(undefined, { jdCacheFile: 'data/jd-cache.json' })],
    ['lever', () => LeverBoardScanner.fromConfig()],
    ['ashby', () => AshbyBoardScanner.fromConfig()],
    ['swelist', () => new SWEListScanner()],
    ['newgrad', () => new NewGradScanner()],
  ];

  // Sources run concurrently (each board scanner is itself concurrency-capped
  // internally), so a 100+ board sweep finishes well inside the 60s cadence.
  const perSource = await Promise.all(
    scanners.map(async ([name, make]) => {
      try {
        return await make().scanFresh(QUERY);
      } catch (err) {
        log.warn(`source "${name}" failed, skipping: ${(err as Error).message}`);
        return [] as Job[];
      }
    })
  );
  const all: Job[] = perSource.flat();

  // Back-fill a blank location on existing hot-list entries from this scan's
  // richer record for the same id (the append-only + seen-set hot-list never
  // otherwise updates a role caught before location parsing existed). Safe:
  // pure merge, wrapped so it can never break the 60s loop; runs every cycle.
  try {
    const scanById = new Map(all.map((j) => [j.id, { location: j.location }]));
    const current = readJson<Array<Record<string, unknown>>>(HOTLIST_PATH, []);
    const { list, enriched } = enrichHotlist(current, scanById);
    if (enriched > 0) {
      writeJson(HOTLIST_PATH, list);
      log.info(`Enriched ${enriched} hot-list entries with a location from the current scan.`);
    }
  } catch (err) {
    log.warn(`hot-list enrichment skipped: ${(err as Error).message}`);
  }

  const seen = readJson<{ ids: string[] }>(SEEN_PATH, { ids: [] });
  const { fresh, nextSeen, firstRun } = detectNewPostings(all, seen.ids);

  writeJson(SEEN_PATH, { ids: nextSeen, updatedAt: new Date().toISOString() });

  // WATCH_SEED=1: absorb the current board state into the seen-set WITHOUT
  // alerting. Run this once after expanding the board list, so the backlog of
  // fresh roles on the newly-added boards does not fire a burst of banners;
  // from the next run on, only genuinely-new postings alert.
  if (firstRun || process.env.WATCH_SEED === '1') {
    log.info(`Seeded ${nextSeen.length} postings (no alerts). New postings from now on will notify.`);
    return;
  }

  // The ROLE matters, not the company: only alert on new postings that are BOTH
  // in Parv's field (AI/ML/SWE/robotics/AV) AND F-1-eligible.
  const relevant = fresh.filter((j) => isRelevantRole(j.title) && eligible(j));
  if (relevant.length === 0) {
    log.info(`Scanned ${all.length}; ${fresh.length} new, 0 on-field + F-1-eligible to alert.`);
    return;
  }

  // Append to the hot-list (most recent first, capped).
  const caughtAt = new Date().toISOString();
  const hot = readJson<Array<Record<string, unknown>>>(HOTLIST_PATH, []);
  const entries = relevant.map((j) => ({
    id: j.id, company: j.company, role: j.title, applyUrl: j.applyUrl ?? j.url,
    platform: j.platform, postedAt: j.postedAt, caughtAt,
    // Title-only: the JD is noisy with company context ("our AI platform"),
    // which would pull plain SWE roles into AI/ML. The title names the role.
    category: categorize(j.title), location: j.location ?? '',
  }));
  writeJson(HOTLIST_PATH, [...entries, ...hot].slice(0, HOTLIST_CAP));

  // Notify (capped so a bulk board update can't fire 50 banners).
  const notifier = new Notifier();
  for (const j of relevant.slice(0, NOTIFY_CAP)) {
    notifier.newPosting(j.company, j.title, j.applyUrl ?? j.url);
  }
  const extra = relevant.length - Math.min(relevant.length, NOTIFY_CAP);
  if (extra > 0) notifier.batchComplete(`+${extra} more new postings — see ${HOTLIST_PATH}`);

  log.info(`Scanned ${all.length}; ${fresh.length} new, alerted ${Math.min(relevant.length, NOTIFY_CAP)} (on-field, F-1-eligible), hot-list at ${HOTLIST_PATH}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
