/**
 * Scans Lever job boards via the public postings API. Like Greenhouse: no
 * browser, no auth, full JD text, and a real posting date (createdAt).
 * REF: https://github.com/lever/postings-api  (GET /v0/postings/{company}?mode=json)
 *
 * WHY createdAt: Lever exposes the posting's creation epoch and no "updated"
 * field that could launder a stale posting (the Greenhouse first_published vs
 * updated_at trap does not exist here). A missing createdAt becomes an empty
 * postedAt so the pipeline's unknown bucket reports the data-quality gap.
 *
 * WHY categories.commitment matters: Lever tags each posting's commitment
 * ("Internship", "Full-time", ...). It is a stronger role signal than the
 * title alone, so an "Internship"-commitment posting is kept even if the title
 * does not contain "intern".
 */

import fs from 'fs';
import yaml from 'js-yaml';
import { Scanner } from './Scanner.js';
import { htmlToText } from './GreenhouseBoardScanner.js';
import type { Job, Platform, ScanQuery } from '../types.js';

interface LeverPosting {
  id: string;
  text: string; // title
  hostedUrl?: string;
  applyUrl?: string;
  categories?: { commitment?: string; location?: string; team?: string };
  createdAt?: number; // epoch ms
  descriptionPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
}

export interface LeverBoardsConfig {
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

const API = 'https://api.lever.co/v0/postings';
const DEFAULT_MAX_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const INTERN_COMMITMENT = /intern|co-?op/i;

export class LeverBoardScanner extends Scanner {
  readonly platform: Platform = 'lever';

  constructor(
    private readonly cfg: LeverBoardsConfig,
    private readonly fetchFn: FetchLike = fetch
  ) {
    super();
  }

  static fromConfig(configPath = 'config/lever-boards.yml'): LeverBoardScanner {
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as {
      companies?: string[];
      title_include?: string[];
      title_exclude?: string[];
    };
    return new LeverBoardScanner({
      companies: raw.companies ?? [],
      titleInclude: raw.title_include ?? ['intern', 'internship', 'co-op', 'coop'],
      titleExclude: raw.title_exclude ?? [],
    });
  }

  protected async scan(query: ScanQuery): Promise<Job[]> {
    const maxDays = query.postedWithinDays ?? DEFAULT_MAX_DAYS;
    const now = Date.now();
    const jobs: Job[] = [];

    for (const company of this.cfg.companies) {
      let postings: LeverPosting[];
      try {
        const res = await this.fetchFn(`${API}/${company}?mode=json`);
        if (!res.ok) {
          this.log.warn(`Lever "${company}": HTTP ${res.status}, skipping`);
          continue;
        }
        const body = await res.json();
        postings = Array.isArray(body) ? (body as LeverPosting[]) : [];
      } catch (err) {
        this.log.warn(`Lever "${company}": ${(err as Error).message}, skipping`);
        continue;
      }

      for (const p of postings) {
        if (!this.wanted(p.text, p.categories?.commitment)) continue;

        const postedMs = typeof p.createdAt === 'number' ? p.createdAt : NaN;
        // Parseable-but-old skips early. Unknown date stays in with postedAt ''
        // so the pipeline's unknown bucket reports it.
        if (!Number.isNaN(postedMs) && (now - postedMs) / MS_PER_DAY > maxDays) continue;

        const url = p.hostedUrl ?? p.applyUrl ?? '';
        jobs.push({
          id: this.generateJobId(company, p.text, url),
          title: p.text,
          company,
          url,
          applyUrl: p.applyUrl ?? p.hostedUrl ?? url,
          platform: this.platform,
          location: p.categories?.location ?? '',
          remote: /remote/i.test(p.categories?.location ?? ''),
          postedAt: Number.isNaN(postedMs) ? '' : new Date(postedMs).toISOString(),
          discoveredAt: new Date().toISOString().split('T')[0]!,
          jd: this.buildJd(p),
          status: 'discovered',
        });
      }
    }
    return jobs;
  }

  private wanted(title: string, commitment?: string): boolean {
    const t = title.toLowerCase();
    if (this.cfg.titleExclude.some((p) => t.includes(p.toLowerCase()))) return false;
    return (
      this.cfg.titleInclude.some((p) => t.includes(p.toLowerCase())) ||
      INTERN_COMMITMENT.test(commitment ?? '')
    );
  }

  private buildJd(p: LeverPosting): string {
    const parts: string[] = [];
    if (p.descriptionPlain) parts.push(p.descriptionPlain.trim());
    for (const l of p.lists ?? []) {
      const heading = (l.text ?? '').trim();
      const body = htmlToText(l.content ?? '');
      if (body) parts.push(heading ? `${heading}: ${body}` : body);
    }
    return parts.join('\n').replace(/\s+\n/g, '\n').trim();
  }
}
