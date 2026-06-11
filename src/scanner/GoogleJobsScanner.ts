/**
 * Scans Google Jobs via direct Playwright.
 * WHY: Free Apify actors for Google Jobs are either gone or paid.
 * Google Jobs search results are public — Playwright gets them directly.
 * Catches postings from company career pages not on LinkedIn or Wellfound.
 */

import { chromium } from 'playwright';
import type { Job, ScanQuery } from '../types.js';
import { Scanner } from './Scanner.js';

// Google Jobs surfaces when you search with ibp=htl;jobs
const GOOGLE_JOBS_URL = 'https://www.google.com/search?ibp=htl%3Bjobs';

export class GoogleJobsScanner extends Scanner {
  readonly platform = 'googlejobs' as const;

  protected async scan(query: ScanQuery): Promise<Job[]> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const jobs: Job[] = [];

    // Rotate user agent to reduce bot detection
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    try {
      const queries = this.buildQueries(query);

      for (const searchQuery of queries) {
        const url = `${GOOGLE_JOBS_URL}&q=${encodeURIComponent(searchQuery)}`;
        this.log.info(`Google Jobs: "${searchQuery}"`);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(2_000);

        // Google Jobs cards live inside the htl-jobs widget
        const cards = await page.$$('[jsname] li[data-jobkey], [class*="iFjolb"], [data-ved] [role="listitem"]');

        for (const card of cards.slice(0, 15)) {
          try {
            const title = await card.$eval(
              '[class*="BjJfJf"], [class*="title"], h3',
              (el) => el.textContent?.trim() ?? ''
            ).catch(() => '');

            const company = await card.$eval(
              '[class*="vNEEBe"], [class*="company"]',
              (el) => el.textContent?.trim() ?? ''
            ).catch(() => 'Unknown');

            const location = await card.$eval(
              '[class*="Qk80Jf"], [class*="location"]',
              (el) => el.textContent?.trim() ?? ''
            ).catch(() => '');

            const posted = await card.$eval(
              '[class*="SuWscb"], [class*="date"]',
              (el) => el.textContent?.trim() ?? ''
            ).catch(() => '');

            // Click card to reveal the apply link in the side panel
            await card.click().catch(() => {});
            await page.waitForTimeout(800);

            const applyUrl = await page.$eval(
              'a[class*="pMhGee"], a[href*="apply"], a[data-url]',
              (el) => (el as HTMLAnchorElement).href ?? ''
            ).catch(() => '');

            if (title && company !== 'Unknown') {
              const url = applyUrl || `https://www.google.com/search?q=${encodeURIComponent(title + ' ' + company)}&ibp=htl%3Bjobs`;
              jobs.push({
                id: this.generateJobId(company, title, url),
                title,
                company,
                url,
                applyUrl: applyUrl || url,
                platform: 'googlejobs',
                location,
                remote: location.toLowerCase().includes('remote'),
                postedAt: this.parsePosted(posted),
                discoveredAt: new Date().toISOString(),
                jd: `${title} at ${company}\nLocation: ${location}`,
                status: 'discovered',
              });
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      await browser.close();
    }

    // Deduplicate by id
    const seen = new Set<string>();
    return jobs.filter((j) => {
      if (seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    });
  }

  private buildQueries(query: ScanQuery): string[] {
    const base = query.keywords?.slice(0, 3) ?? ['software engineer'];
    return base.map((kw) => `${kw} internship ${query.location ?? 'San Francisco Bay Area'} 2026`);
  }

  private parsePosted(raw: string): string {
    const match = /(\d+)\s*(day|hour|week|month)/i.exec(raw);
    if (!match) return new Date().toISOString();
    const n = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();
    const ms = unit.startsWith('hour') ? n * 3_600_000
      : unit.startsWith('day') ? n * 86_400_000
      : unit.startsWith('week') ? n * 7 * 86_400_000
      : n * 30 * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }
}
