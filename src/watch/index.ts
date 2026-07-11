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
import { INELIGIBLE_KEYWORDS } from '../orchestrator/queuePlanning.js';
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
    ['greenhouse', () => GreenhouseBoardScanner.fromConfig()],
    ['lever', () => LeverBoardScanner.fromConfig()],
    ['ashby', () => AshbyBoardScanner.fromConfig()],
    ['swelist', () => new SWEListScanner()],
    ['newgrad', () => new NewGradScanner()],
  ];

  const all: Job[] = [];
  for (const [name, make] of scanners) {
    try {
      const jobs = await make().scanFresh(QUERY);
      all.push(...jobs);
    } catch (err) {
      log.warn(`source "${name}" failed, skipping: ${(err as Error).message}`);
    }
  }

  const seen = readJson<{ ids: string[] }>(SEEN_PATH, { ids: [] });
  const { fresh, nextSeen, firstRun } = detectNewPostings(all, seen.ids);

  writeJson(SEEN_PATH, { ids: nextSeen, updatedAt: new Date().toISOString() });

  if (firstRun) {
    log.info(`Seeded ${nextSeen.length} existing postings (first run, no alerts). New postings from now on will notify.`);
    return;
  }

  const relevant = fresh.filter(eligible);
  if (relevant.length === 0) {
    log.info(`Scanned ${all.length}; ${fresh.length} new, 0 F-1-eligible to alert.`);
    return;
  }

  // Append to the hot-list (most recent first, capped).
  const caughtAt = new Date().toISOString();
  const hot = readJson<Array<Record<string, unknown>>>(HOTLIST_PATH, []);
  const entries = relevant.map((j) => ({
    id: j.id, company: j.company, role: j.title, applyUrl: j.applyUrl ?? j.url,
    platform: j.platform, postedAt: j.postedAt, caughtAt,
  }));
  writeJson(HOTLIST_PATH, [...entries, ...hot].slice(0, HOTLIST_CAP));

  // Notify (capped so a bulk board update can't fire 50 banners).
  const notifier = new Notifier();
  for (const j of relevant.slice(0, NOTIFY_CAP)) {
    notifier.newPosting(j.company, j.title, j.applyUrl ?? j.url);
  }
  const extra = relevant.length - Math.min(relevant.length, NOTIFY_CAP);
  if (extra > 0) notifier.batchComplete(`+${extra} more new postings — see ${HOTLIST_PATH}`);

  log.info(`Scanned ${all.length}; ${fresh.length} new, alerted ${Math.min(relevant.length, NOTIFY_CAP)} (F-1-eligible), hot-list at ${HOTLIST_PATH}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
