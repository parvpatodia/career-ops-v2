/**
 * Scans Greenhouse job boards via the public boards API. No browser, no
 * auth, full JD text, and real posting dates.
 * REF: https://developers.greenhouse.io/job-board.html
 *
 * WHY first_published and never updated_at: verified live 2026-06-12, an
 * Anthropic posting showed updated_at 4 days old with first_published 18
 * months old. updated_at refreshes on edits and would launder stale
 * postings straight through the 14-day freshness invariant (AGENTS.md 9).
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Scanner } from './Scanner.js';
import { mapPool } from '../utils/pool.js';
import { timeoutFetch } from '../utils/httpFetch.js';
import type { Job, Platform, ScanQuery } from '../types.js';

interface GhListJob {
  id: number;
  title: string;
  absolute_url: string;
  company_name?: string;
  first_published?: string | null;
  updated_at?: string;
  application_deadline?: string | null;
  location?: { name?: string } | null;
}

export interface GreenhouseBoardsConfig {
  boards: string[];
  titleInclude: string[];
  titleExclude: string[];
}

/** Structural subset of global fetch so tests inject a fake. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const API = 'https://boards-api.greenhouse.io/v1/boards';
const DEFAULT_MAX_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const CONCURRENCY = 8; // parallel boards per cycle (polite to the public API)
const JD_CACHE_CAP = 8_000; // bounded so the on-disk JD cache cannot grow forever

export class GreenhouseBoardScanner extends Scanner {
  readonly platform: Platform = 'greenhouse';

  constructor(
    private readonly cfg: GreenhouseBoardsConfig,
    private readonly fetchFn: FetchLike = timeoutFetch(),
    // Opt-in cross-run JD cache file. WHY: the JD detail fetch is the one call
    // that scales with matching-job count, and the 60s watch would re-fetch the
    // same JDs every cycle. With a cache file the watch fetches each posting's JD
    // once, ever. Left undefined (no cache) for tests + the one-shot daily scan.
    private readonly jdCacheFile?: string
  ) {
    super();
  }

  static fromConfig(
    configPath = 'config/greenhouse-boards.yml',
    opts: { jdCacheFile?: string } = {}
  ): GreenhouseBoardScanner {
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as {
      boards?: string[];
      title_include?: string[];
      title_exclude?: string[];
    };
    return new GreenhouseBoardScanner(
      {
        boards: raw.boards ?? [],
        titleInclude: raw.title_include ?? ['intern', 'internship', 'co-op', 'coop'],
        titleExclude: raw.title_exclude ?? [],
      },
      timeoutFetch(),
      opts.jdCacheFile
    );
  }

  protected async scan(query: ScanQuery): Promise<Job[]> {
    const maxDays = query.postedWithinDays ?? DEFAULT_MAX_DAYS;
    const now = Date.now();
    // Boards fetched in parallel (concurrency-capped) so a 100+ board list
    // finishes inside the 60s watch cadence. mapPool preserves board order, so
    // the flattened output — and every Job id — is identical to a serial run.
    const jdCache = this.loadJdCache();
    const perBoard = await mapPool(this.cfg.boards, (token) => this.scanBoard(token, maxDays, now, jdCache), CONCURRENCY);
    this.saveJdCache(jdCache);
    return perBoard.flat();
  }

  private async scanBoard(token: string, maxDays: number, now: number, jdCache: Map<string, string>): Promise<Job[]> {
    let listing: { jobs?: GhListJob[] };
    try {
      const res = await this.fetchFn(`${API}/${token}/jobs`);
      if (!res.ok) {
        this.log.warn(`Board "${token}": HTTP ${res.status}, skipping`);
        return [];
      }
      listing = (await res.json()) as { jobs?: GhListJob[] };
    } catch (err) {
      this.log.warn(`Board "${token}": ${(err as Error).message}, skipping`);
      return [];
    }

    const jobs: Job[] = [];
    for (const j of listing.jobs ?? []) {
      if (!this.titleWanted(j.title)) continue;
      if (this.deadlinePassed(j.application_deadline, now)) continue;

      const postedAt = j.first_published ?? '';
      const postedMs = Date.parse(postedAt);
      // Parseable-but-old skips early (saves a detail fetch). An
      // unparseable date stays in with postedAt '' so the pipeline's
      // unknown bucket reports the data-quality problem visibly.
      if (!Number.isNaN(postedMs) && (now - postedMs) / MS_PER_DAY > maxDays) continue;

      const company = j.company_name ?? token;
      jobs.push({
        id: this.generateJobId(company, j.title, j.absolute_url),
        title: j.title,
        company,
        url: j.absolute_url,
        applyUrl: j.absolute_url,
        platform: this.platform,
        location: j.location?.name ?? '',
        remote: /remote/i.test(j.location?.name ?? ''),
        postedAt,
        discoveredAt: new Date().toISOString().split('T')[0]!,
        jd: await this.fetchJd(token, j.id, jdCache),
        status: 'discovered',
      });
    }
    return jobs;
  }

  /** Load the cross-run JD cache (jobId -> jd). Empty when caching is disabled. */
  private loadJdCache(): Map<string, string> {
    if (!this.jdCacheFile) return new Map();
    try {
      const obj = JSON.parse(fs.readFileSync(this.jdCacheFile, 'utf8')) as Record<string, string>;
      return new Map(Object.entries(obj));
    } catch {
      return new Map();
    }
  }

  /** Persist the JD cache, capped to the most-recent JD_CACHE_CAP entries. */
  private saveJdCache(cache: Map<string, string>): void {
    if (!this.jdCacheFile) return;
    try {
      const capped = [...cache.entries()].slice(-JD_CACHE_CAP);
      fs.mkdirSync(path.dirname(this.jdCacheFile), { recursive: true });
      fs.writeFileSync(this.jdCacheFile, JSON.stringify(Object.fromEntries(capped)));
    } catch {
      /* best-effort: a cache write failure must never break the scan */
    }
  }

  private titleWanted(title: string): boolean {
    const t = title.toLowerCase();
    return (
      this.cfg.titleInclude.some((p) => t.includes(p.toLowerCase())) &&
      !this.cfg.titleExclude.some((p) => t.includes(p.toLowerCase()))
    );
  }

  private deadlinePassed(deadline: string | null | undefined, now: number): boolean {
    if (!deadline) return false;
    const ms = Date.parse(deadline);
    return !Number.isNaN(ms) && ms < now;
  }

  private async fetchJd(token: string, jobId: number, jdCache: Map<string, string>): Promise<string> {
    const key = `${token}:${jobId}`;
    const cached = jdCache.get(key);
    if (cached !== undefined) return cached; // fetched on an earlier cycle
    try {
      const res = await this.fetchFn(`${API}/${token}/jobs/${jobId}`);
      if (!res.ok) return ''; // don't cache a failure — retry next cycle
      const detail = (await res.json()) as { content?: string };
      const jd = htmlToText(detail.content ?? '');
      jdCache.set(key, jd);
      return jd;
    } catch {
      // Empty JD lands in the evaluator's low-signal path, visible in scores.
      return '';
    }
  }
}

/**
 * Greenhouse serves content as HTML-escaped HTML, i.e. escaped TWICE for
 * plain text inside tags ("&" arrives as "&amp;amp;"). So: decode the API
 * layer, strip tags, decode the document's own entities.
 */
export function htmlToText(escaped: string): string {
  const html = decodeEntities(escaped);
  const text = html.replace(/<[^>]+>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
