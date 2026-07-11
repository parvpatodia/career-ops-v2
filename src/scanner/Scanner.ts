/**
 * Abstract base scanner. Each platform extends this.
 * WHY: Abstract base with template method (scanWithCache) enforces caching
 * across all implementations without duplicating the cache logic per scanner.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Job, Platform, ScanQuery } from '../types.js';
import { Logger } from '../utils/Logger.js';

const DEFAULT_CACHE_DIR = 'data/daily_log';
const TODAY = new Date().toISOString().split('T')[0];

export abstract class Scanner {
  abstract readonly platform: Platform;
  protected log: Logger;
  // WHY injectable: tests with the default path wrote fixture jobs into
  // the real data/daily_log for a month, and on 2026-06-12 the pipeline
  // queued TestCo as application 371. Tests must inject a temp dir.
  protected readonly cacheDir: string;

  constructor(cacheDir: string = DEFAULT_CACHE_DIR) {
    this.log = new Logger(this.constructor.name);
    this.cacheDir = cacheDir;
  }

  /** Scan for jobs matching the query. Implement per platform. */
  protected abstract scan(query: ScanQuery): Promise<Job[]>;

  /**
   * Public entry point. Returns cached results if scanned today.
   * WHY: Prevents re-scraping the same platform multiple times per day,
   * saving token budget and rate-limit headroom.
   */
  async scanWithCache(query: ScanQuery): Promise<Job[]> {
    const cacheKey = this.getCacheKey(query);
    const cached = this.loadCache(cacheKey);
    if (cached) {
      this.log.info(`Cache hit for ${this.platform}, returning ${cached.length} jobs`);
      return cached;
    }

    this.log.info(`Scanning ${this.platform}...`, query);
    const results = await this.scan(query);
    this.saveCache(cacheKey, results);
    this.log.info(`Found ${results.length} jobs on ${this.platform}`);
    return results;
  }

  /**
   * Force a FRESH scan, bypassing the daily cache. The new-posting watcher must
   * see jobs posted later the same day (the cache would hide them), so it calls
   * this instead of scanWithCache. Does not write the daily cache: the watcher
   * tracks its own seen-set, and a partial watch run must not shadow the real
   * daily scan's cache.
   */
  async scanFresh(query: ScanQuery): Promise<Job[]> {
    return this.scan(query);
  }

  protected generateJobId(company: string, title: string, url: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${company}:${title}:${url}`)
      .digest('hex')
      .slice(0, 8);
    return `${this.platform}-${hash}`;
  }

  private getCacheKey(query: ScanQuery): string {
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(query))
      .digest('hex')
      .slice(0, 8);
    return `${TODAY}-${this.platform}-${hash}`;
  }

  private loadCache(key: string): Job[] | null {
    const file = path.join(this.cacheDir, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Job[];
    } catch {
      return null;
    }
  }

  private saveCache(key: string, jobs: Job[]): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(
        path.join(this.cacheDir, `${key}.json`),
        JSON.stringify(jobs, null, 2)
      );
    } catch (err) {
      this.log.warn('Failed to write cache', err);
    }
  }
}
