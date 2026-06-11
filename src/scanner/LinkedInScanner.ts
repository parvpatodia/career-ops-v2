/**
 * Scans LinkedIn Jobs via Apify actor.
 * WHY: LinkedIn has the highest volume of ML/AI internship postings
 * but blocks direct scraping. Apify provides managed actors with
 * session rotation and proxy support that survive LinkedIn's bot detection.
 */

import type { Job, ScanQuery } from '../types.js';
import { Scanner } from './Scanner.js';
import { Validator } from '../utils/Validator.js';

const ACTOR_ID = 'curious_coder/linkedin-jobs-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';

interface ApifyLinkedInJob {
  id?: string;
  title?: string;
  companyName?: string;
  location?: string;
  url?: string;
  applyUrl?: string;
  description?: string;
  postedAt?: string;
  workplaceType?: string;
}

export class LinkedInScanner extends Scanner {
  readonly platform = 'linkedin' as const;

  protected async scan(query: ScanQuery): Promise<Job[]> {
    Validator.requireApifyToken();
    const token = process.env['APIFY_TOKEN']!;

    // WHY: curious_coder/linkedin-jobs-scraper expects `urls` array, not `searchUrl`.
    const input = {
      urls: [this.buildSearchUrl(query)],
      maxJobs: 50,
      proxy: { useApifyProxy: true },
    };

    // Run actor and wait for results
    const runRes = await fetch(
      `${APIFY_BASE}/acts/${encodeURIComponent(ACTOR_ID)}/run-sync-get-dataset-items?token=${token}&timeout=120`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );

    if (!runRes.ok) {
      const text = await runRes.text();
      throw new Error(`Apify LinkedIn actor failed: ${runRes.status} ${text}`);
    }

    const items = (await runRes.json()) as ApifyLinkedInJob[];
    return items.map((item) => this.toJob(item));
  }

  private buildSearchUrl(query: ScanQuery): string {
    const keywords = (query.keywords ?? ['machine learning']).join(' OR ');
    const location = query.location ?? 'San Francisco Bay Area';
    const base = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}`;
    const dayAgo = query.postedWithinDays ?? 2;
    // LinkedIn f_TPR: r86400=24h, r172800=48h, r604800=7d
    const tpr = dayAgo <= 1 ? 'r86400' : dayAgo <= 2 ? 'r172800' : 'r604800';
    return `${base}&f_TPR=${tpr}&f_JT=I`; // I = Internship
  }

  private toJob(item: ApifyLinkedInJob): Job {
    const url = item.url ?? item.applyUrl ?? '';
    return {
      id: this.generateJobId(item.companyName ?? '', item.title ?? '', url),
      title: item.title ?? 'Unknown Role',
      company: item.companyName ?? 'Unknown Company',
      url,
      applyUrl: item.applyUrl ?? url,
      platform: 'linkedin',
      location: item.location ?? '',
      remote: (item.workplaceType ?? '').toLowerCase().includes('remote'),
      postedAt: item.postedAt ?? new Date().toISOString(),
      discoveredAt: new Date().toISOString(),
      jd: item.description ?? '',
      status: 'discovered',
    };
  }
}
