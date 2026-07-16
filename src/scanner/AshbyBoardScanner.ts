/**
 * Scans Ashby job boards via the public posting API. Like Greenhouse/Lever: no
 * browser, no auth, full JD text (descriptionPlain), and a real posting date
 * (publishedAt). Closes the Ashby asymmetry — the system already APPLIES to
 * Ashby (AshbyHQ FormSource) but could not SOURCE from it until now.
 * REF: GET https://api.ashbyhq.com/posting-api/job-board/{org}  ->  { jobs: [...] }
 *
 * WHY employmentType matters: Ashby tags each posting ("Intern", "FullTime", ...)
 * — a stronger role signal than the title, so an "Intern"-type posting is kept
 * even if the title omits "intern" (mirrors Lever's categories.commitment).
 * WHY isListed: an unlisted posting is not public; skip it.
 * WHY publishedAt parsed, not trusted blindly: a missing/unparseable date becomes
 * an empty postedAt so the pipeline's unknown bucket reports the data-quality gap
 * (never laundered into "fresh").
 */

import fs from 'fs';
import yaml from 'js-yaml';
import { Scanner } from './Scanner.js';
import { mapPool } from '../utils/pool.js';
import type { Job, Platform, ScanQuery } from '../types.js';

interface AshbyPosting {
  id: string;
  title: string;
  location?: string;
  employmentType?: string;
  publishedAt?: string; // ISO 8601
  isListed?: boolean;
  isRemote?: boolean;
  applyUrl?: string;
  jobUrl?: string;
  descriptionPlain?: string;
}

export interface AshbyBoardsConfig {
  companies: string[];
  titleInclude: string[];
  titleExclude: string[];
}

/** Structural subset of global fetch so tests inject a fake. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const API = 'https://api.ashbyhq.com/posting-api/job-board';
const DEFAULT_MAX_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const CONCURRENCY = 8;
const INTERN_TYPE = /intern|co-?op/i;

export class AshbyBoardScanner extends Scanner {
  readonly platform: Platform = 'ashby';

  constructor(
    private readonly cfg: AshbyBoardsConfig,
    private readonly fetchFn: FetchLike = fetch
  ) {
    super();
  }

  static fromConfig(configPath = 'config/ashby-boards.yml'): AshbyBoardScanner {
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as {
      companies?: string[];
      title_include?: string[];
      title_exclude?: string[];
    };
    return new AshbyBoardScanner({
      companies: raw.companies ?? [],
      titleInclude: raw.title_include ?? ['intern', 'internship', 'co-op', 'coop'],
      titleExclude: raw.title_exclude ?? [],
    });
  }

  protected async scan(query: ScanQuery): Promise<Job[]> {
    const maxDays = query.postedWithinDays ?? DEFAULT_MAX_DAYS;
    const now = Date.now();
    // Parallel, order-preserving (see mapPool): identical output to a serial run.
    const perCompany = await mapPool(this.cfg.companies, (company) => this.scanCompany(company, maxDays, now), CONCURRENCY);
    return perCompany.flat();
  }

  private async scanCompany(company: string, maxDays: number, now: number): Promise<Job[]> {
    let postings: AshbyPosting[];
    try {
      const res = await this.fetchFn(`${API}/${company}?includeCompensation=false`);
      if (!res.ok) {
        this.log.warn(`Ashby "${company}": HTTP ${res.status}, skipping`);
        return [];
      }
      const body = await res.json();
      const list = (body as { jobs?: unknown })?.jobs;
      postings = Array.isArray(list) ? (list as AshbyPosting[]) : [];
    } catch (err) {
      this.log.warn(`Ashby "${company}": ${(err as Error).message}, skipping`);
      return [];
    }

    const jobs: Job[] = [];
    for (const p of postings) {
      if (p.isListed === false) continue; // unlisted -> not public
      if (!this.wanted(p.title, p.employmentType)) continue;

      const postedMs = p.publishedAt ? Date.parse(p.publishedAt) : NaN;
      // Parseable-but-old skips early. Unknown date stays in with postedAt ''
      // so the pipeline's unknown bucket reports it (never laundered as fresh).
      if (!Number.isNaN(postedMs) && (now - postedMs) / MS_PER_DAY > maxDays) continue;

      const url = p.jobUrl ?? p.applyUrl ?? '';
      jobs.push({
        id: this.generateJobId(company, p.title, url),
        title: p.title,
        company,
        url,
        applyUrl: p.applyUrl ?? p.jobUrl ?? url,
        platform: this.platform,
        location: p.location ?? '',
        remote: p.isRemote === true || /remote/i.test(p.location ?? ''),
        postedAt: Number.isNaN(postedMs) ? '' : new Date(postedMs).toISOString(),
        discoveredAt: new Date().toISOString().split('T')[0]!,
        jd: (p.descriptionPlain ?? '').trim(),
        status: 'discovered',
      });
    }
    return jobs;
  }

  private wanted(title: string, employmentType?: string): boolean {
    const t = (title ?? '').toLowerCase();
    if (this.cfg.titleExclude.some((p) => t.includes(p.toLowerCase()))) return false;
    return (
      this.cfg.titleInclude.some((p) => t.includes(p.toLowerCase())) ||
      INTERN_TYPE.test(employmentType ?? '')
    );
  }
}
