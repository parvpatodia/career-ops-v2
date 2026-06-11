/**
 * Scans Handshake for campus internship/co-op postings via Playwright.
 * WHY: Handshake has no public API. Direct Playwright is the only free option.
 * The account uses direct password auth (no school SSO configured).
 */

import { chromium, type Page } from 'playwright';
import type { Job, ScanQuery } from '../types.js';
import { Scanner } from './Scanner.js';

const BASE_URL = 'https://app.joinhandshake.com/stu/postings';
const LOGIN_URL = 'https://app.joinhandshake.com/login';

export class HandshakeScanner extends Scanner {
  readonly platform = 'handshake' as const;

  protected async scan(query: ScanQuery): Promise<Job[]> {
    const email = process.env['HANDSHAKE_EMAIL'];
    const password = process.env['HANDSHAKE_PASSWORD'];

    if (!email || !password) {
      throw new Error('HANDSHAKE_EMAIL and HANDSHAKE_PASSWORD must be set in .env');
    }

    // WHY: headless Chromium is blocked by Cloudflare on app.joinhandshake.com
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const page = await browser.newPage();
    const jobs: Job[] = [];

    try {
      await this.login(page, email, password);

      // Navigate to postings search page
      const searchUrl = this.buildSearchUrl(query);
      this.log.info(`Navigating to ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      if (page.url().includes('/login')) {
        throw new Error('Handshake session lost after login — check credentials in .env');
      }
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

      // WHY: data-hook="job-result-card | {id}" is stable across Handshake deploys
      const cardSelector = '[data-hook^="job-result-card | "]';
      const hasCards = await page.locator(cardSelector).first().isVisible({ timeout: 15_000 }).catch(() => false);

      if (hasCards) {
        jobs.push(...(await this.extractJobs(page)));
      } else {
        this.log.warn('Card selectors not found — falling back to link extraction');
        jobs.push(...(await this.extractJobsFromLinks(page)));
      }
    } finally {
      await browser.close();
    }

    return jobs;
  }

  private async login(page: Page, email: string, password: string): Promise<void> {
    await page.goto(LOGIN_URL);

    // WHY: fill() doesn't trigger Knockout.js observables; pressSequentially simulates real keystrokes
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    await emailInput.waitFor({ timeout: 10_000 });
    await emailInput.pressSequentially(email, { delay: 50 });

    // Wait for button to become enabled (driven by Knockout data-bind on email length)
    const submitBtn = page.locator('button[type="submit"]').first();
    await page.waitForFunction(
      () => { const b = document.querySelector('button[type="submit"]') as HTMLButtonElement | null; return b && !b.disabled; },
      { timeout: 10_000 }
    );
    await submitBtn.click();

    // Wait for auth options to fully load (Handshake defers social login buttons)
    await page.waitForFunction(
      () => !document.body.textContent?.includes('Loading...'),
      { timeout: 10_000 }
    ).catch(() => {});
    await page.waitForTimeout(1_000);

    // Check for school SSO button — only match explicit SSO/SAML links, not school name links
    const ssoBtn = page.locator([
      'button:has-text("Continue with school")',
      'a:has-text("Continue with school")',
      'button:has-text("Sign in with school")',
      'a:has-text("Sign in with school")',
      'a[href*="saml"][href*="login"]',
    ].join(', ')).first();
    const hasSso = await ssoBtn.isVisible({ timeout: 3_000 }).catch(() => false);

    if (hasSso) {
      // School SSO branch (if ever configured on this account)
      await ssoBtn.click();
      await page.waitForURL(/northeastern\.edu|microsoftonline\.com/, { timeout: 15_000 });
      const neuEmail = page.locator('input[type="email"], input[name="loginfmt"]').first();
      await neuEmail.waitFor({ timeout: 10_000 });
      await neuEmail.fill(email);
      await page.locator('button[type="submit"], button:has-text("Next")').first().click();
      const passField = page.locator('input[type="password"], input[name="passwd"]').first();
      await passField.waitFor({ timeout: 10_000 });
      await passField.fill(password);
      await page.locator('button[type="submit"], button:has-text("Sign in")').first().click();
      await page.waitForTimeout(2_000);
      const stayIn = page.locator('button:has-text("Yes"), input[value="Yes"]');
      if (await stayIn.count() > 0) await stayIn.first().click();
      await page.waitForURL(
        (url) => url.hostname === 'app.joinhandshake.com' && !url.pathname.includes('/login'),
        { timeout: 40_000 }
      );
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    } else {
      // Direct password branch
      const passField = page.locator('input[type="password"]').first();
      await passField.waitFor({ timeout: 10_000 });
      await passField.fill(password);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(3_000);
      if (page.url().includes('/login')) {
        throw new Error('Handshake password rejected — reset your password at app.joinhandshake.com, then update HANDSHAKE_PASSWORD in .env');
      }
    }

    this.log.info('Handshake login successful');
  }

  private async extractJobs(page: Page): Promise<Job[]> {
    const jobs: Job[] = [];
    const cards = await page.$$('[data-hook^="job-result-card | "]');

    for (const card of cards) {
      try {
        // Title from the button's aria-label: "View {title}"
        const ariaLabel = await card.$eval(
          'a[role="button"][aria-label]',
          (el) => el.getAttribute('aria-label') ?? ''
        ).catch(() => '');
        const title = ariaLabel.replace(/^View\s+/i, '').trim();

        // Company from employer logo alt text
        const company = await card.$eval(
          'img[alt]',
          (el) => el.getAttribute('alt') ?? 'Unknown'
        ).catch(() => 'Unknown');

        // Location from the card footer
        const location = await card.$eval(
          '[data-hook="job-result-card-footer"] span:first-child',
          (el) => el.textContent?.trim() ?? ''
        ).catch(() => '');

        // URL from the button href
        const href = await card.$eval(
          'a[role="button"][href]',
          (el: { getAttribute: (k: string) => string | null }) => el.getAttribute('href') ?? ''
        ).catch(() => '');
        const link = href.startsWith('http') ? href : `https://app.joinhandshake.com${href}`;

        if (title && link) {
          jobs.push({
            id: this.generateJobId(company, title, link),
            title,
            company,
            url: link,
            applyUrl: link,
            platform: 'handshake',
            location,
            remote: location.toLowerCase().includes('remote'),
            postedAt: new Date().toISOString(),
            discoveredAt: new Date().toISOString(),
            jd: `${title} at ${company}\nLocation: ${location}`,
            status: 'discovered',
          });
        }
      } catch (err) {
        this.log.warn('Failed to parse Handshake card', err);
      }
    }

    return jobs;
  }

  private async extractJobsFromLinks(page: Page): Promise<Job[]> {
    const jobs: Job[] = [];
    const anchors = await page.$$('a[href*="/postings/"], a[href*="/jobs/"]');
    for (const a of anchors.slice(0, 50)) {
      const href = (await a.getAttribute('href').catch(() => '')) ?? '';
      const text = (await a.textContent().catch(() => ''))?.trim() ?? '';
      if (!href || !text || text.length < 5) continue;
      const url = href.startsWith('http') ? href : `https://app.joinhandshake.com${href}`;
      jobs.push({
        id: this.generateJobId('handshake', text, url),
        title: text,
        company: 'Unknown',
        url,
        applyUrl: url,
        platform: 'handshake',
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

  private buildSearchUrl(query: ScanQuery): string {
    const params = new URLSearchParams();
    if (query.keywords?.length) params.set('query', query.keywords.join(' '));
    // WHY: append() allows multiple values; set() would overwrite the first job_type
    params.append('job_type[]', '1'); // 1 = Internship
    params.append('job_type[]', '3'); // 3 = Co-op
    return `${BASE_URL}?${params.toString()}`;
  }
}
