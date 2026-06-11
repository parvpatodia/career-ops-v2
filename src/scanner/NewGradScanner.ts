/**
 * Scans the SimplifyJobs New-Grad-Positions GitHub repo.
 * WHY: Same maintainers as SWEList, same format, but full-time new grad roles
 * rather than internships. Parv graduates May 2027 so Fall 2026 / 2027 new grad
 * roles are valid targets alongside internships.
 */

import type { Job, ScanQuery } from '../types.js';
import { Scanner } from './Scanner.js';

const README_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md';

export class NewGradScanner extends Scanner {
  readonly platform = 'newgrad' as const;

  protected async scan(query: ScanQuery): Promise<Job[]> {
    const response = await fetch(README_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch NewGrad README: ${response.statusText}`);
    }
    const text = await response.text();
    return this.parseHtmlTable(text, query);
  }

  private parseHtmlTable(html: string, query: ScanQuery): Job[] {
    const jobs: Job[] = [];
    const keywords = (query.keywords ?? []).map((k) => k.toLowerCase());
    const rows = html.split(/<tr>/i).slice(1);

    for (const row of rows) {
      const cells: string[] = [];
      const cellRe = /<td>([\s\S]*?)<\/td>/gi;
      let m: RegExpExecArray | null;
      while ((m = cellRe.exec(row)) !== null) cells.push(m[1]!.trim());

      if (cells.length !== 5) continue;
      const [companyCell, roleCell, locationCell, applyCell, ageCell] = cells as [string, string, string, string, string];

      const company = this.stripHtml(companyCell).replace(/^[🔥\s]+/, '').trim();
      if (!company) continue;

      const role = this.stripHtml(roleCell).trim();
      if (!role || role === '↳') continue;

      if (applyCell.toLowerCase().includes('closed') ||
          applyCell.toLowerCase().includes('no longer')) continue;

      const roleLC = role.toLowerCase();
      const matchesKeyword = keywords.length === 0 || keywords.some((kw) => roleLC.includes(kw));
      if (!matchesKeyword) continue;

      const location = this.extractLocation(locationCell);
      const applyUrl = this.extractFirstUrl(applyCell);
      if (!applyUrl) continue;

      const postedAt = this.parseAge(ageCell.trim());
      const id = this.generateJobId(company + '-ng', role, applyUrl);

      jobs.push({
        id,
        title: role,
        company,
        url: applyUrl,
        applyUrl,
        platform: 'newgrad',
        location,
        remote: location.toLowerCase().includes('remote'),
        postedAt,
        discoveredAt: new Date().toISOString(),
        jd: `${role} at ${company}\nLocation: ${location}\nType: Full-time (New Grad)`,
        sponsorshipMentioned: false,
        status: 'discovered',
      });
    }

    return jobs;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private extractLocation(cell: string): string {
    const detailsMatch = /<summary><strong>(\d+ locations?)<\/strong><\/summary>([\s\S]*?)<\/details>/i.exec(cell);
    if (detailsMatch) {
      const inner = detailsMatch[2]!.replace(/<br\s*\/?>/gi, '\n');
      return this.stripHtml(inner).split('\n')[0]?.trim() ?? detailsMatch[1]!;
    }
    return this.stripHtml(cell);
  }

  private extractFirstUrl(cell: string): string {
    const match = /href="(https?:\/\/[^"]+)"/i.exec(cell);
    return match ? match[1]! : '';
  }

  private parseAge(raw: string): string {
    const match = /^(\d+)d$/.exec(raw);
    if (match) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(match[1]!, 10));
      return d.toISOString();
    }
    return new Date().toISOString();
  }
}
