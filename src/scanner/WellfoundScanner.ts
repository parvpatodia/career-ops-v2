/**
 * Scans Wellfound (AngelList Talent) job listings via direct Playwright.
 * WHY: No reliable free Apify actor exists for Wellfound. Job listings are
 * public (no login required) so direct Playwright is free and sufficient.
 */

import { chromium } from 'playwright';
import type { Job, ScanQuery } from '../types.js';
import { Scanner } from './Scanner.js';

const BASE_URL = 'https://wellfound.com/jobs';

export class WellfoundScanner extends Scanner {
  readonly platform = 'wellfound' as const;

  protected async scan(query: ScanQuery): Promise<Job[]> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const jobs: Job[] = [];

    try {
      const searchUrl = this.buildSearchUrl(query);
      this.log.info(`Fetching ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Scroll to trigger lazy-loaded results
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => { (globalThis as unknown as { scrollBy: (x: number, y: number) => void }).scrollBy(0, 1200); });
        await page.waitForTimeout(1_200);
      }

      // Try the structured card selectors Wellfound uses
      const cardSelectors = [
        '[data-test="JobListing"]',
        '[class*="styles_component"]',
        'div[class*="JobSearchResult"]',
      ];

      let cards: Awaited<ReturnType<typeof page.$$>> = [];
      for (const sel of cardSelectors) {
        cards = await page.$$(sel);
        if (cards.length > 0) break;
      }

      if (cards.length === 0) {
        // Fallback: grab any /jobs/ links with text
        const anchors = await page.$$('a[href*="/jobs/"]');
        for (const a of anchors.slice(0, 40)) {
          const href = (await a.getAttribute('href').catch(() => '')) ?? '';
          const text = (await a.textContent().catch(() => ''))?.trim() ?? '';
          if (!href || !text || text.length < 5) continue;
          const url = href.startsWith('http') ? href : `https://wellfound.com${href}`;
          jobs.push({
            id: this.generateJobId('wellfound', text, url),
            title: text,
            company: 'Unknown',
            url,
            applyUrl: url,
            platform: 'wellfound',
            location: '',
            remote: false,
            postedAt: new Date().toISOString(),
            discoveredAt: new Date().toISOString(),
            jd: text,
            status: 'discovered',
          });
        }
        return jobs;
      }

      for (const card of cards) {
        try {
          const title = await card.$eval(
            '[class*="title"], [class*="role"], h3, h4',
            (el) => el.textContent?.trim() ?? ''
          ).catch(() => '');

          const company = await card.$eval(
            '[class*="company"], [class*="startup"], [class*="employer"]',
            (el) => el.textContent?.trim() ?? ''
          ).catch(() => 'Unknown');

          const location = await card.$eval(
            '[class*="location"]',
            (el) => el.textContent?.trim() ?? ''
          ).catch(() => '');

          const link = await card.$eval(
            'a[href]',
            (el) => (el as HTMLAnchorElement).href ?? ''
          ).catch(() => '');

          if (title && link) {
            jobs.push({
              id: this.generateJobId(company, title, link),
              title,
              company,
              url: link,
              applyUrl: link,
              platform: 'wellfound',
              location,
              remote: location.toLowerCase().includes('remote'),
              postedAt: new Date().toISOString(),
              discoveredAt: new Date().toISOString(),
              jd: `${title} at ${company}\nLocation: ${location}`,
              status: 'discovered',
            });
          }
        } catch {
          // skip malformed card
        }
      }
    } finally {
      await browser.close();
    }

    return jobs;
  }

  private buildSearchUrl(query: ScanQuery): string {
    const params = new URLSearchParams();
    if (query.keywords?.length) {
      // Wellfound search works best with concise terms
      params.set('q', query.keywords.slice(0, 2).join(' '));
    }
    params.set('role', 'intern');
    return `${BASE_URL}?${params.toString()}`;
  }
}
