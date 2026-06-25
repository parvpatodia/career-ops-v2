/**
 * Scans the SimplifyJobs Summer2026-Internships GitHub repo.
 * WHY: SWEList is the most comprehensive intern list, updated daily, free,
 * no auth required. Best ROI scan — run it first every session.
 * NOTE: The README uses HTML <tr>/<td> rows, not markdown pipe tables.
 */

import type { Job, ScanQuery } from '../types.js';
import { Scanner } from './Scanner.js';
import { resolveContinuationCompany } from './continuationCompany.js';

const README_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md';

export class SWEListScanner extends Scanner {
  readonly platform = 'swelist' as const;

  protected async scan(query: ScanQuery): Promise<Job[]> {
    const response = await fetch(README_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch SWEList README: ${response.statusText}`);
    }
    const text = await response.text();
    return this.parseHtmlTable(text, query);
  }

  private parseHtmlTable(html: string, query: ScanQuery): Job[] {
    const jobs: Job[] = [];
    const keywords = (query.keywords ?? []).map((k) => k.toLowerCase());

    // Split on <tr> boundaries and process each row
    const rows = html.split(/<tr>/i).slice(1); // first element is content before first <tr>

    let lastCompany = ''; // carries a real company name onto its "↳" continuation rows
    for (const row of rows) {
      // Extract all <td>...</td> cells
      const cells: string[] = [];
      const cellRe = /<td>([\s\S]*?)<\/td>/gi;
      let m: RegExpExecArray | null;
      while ((m = cellRe.exec(row)) !== null) {
        cells.push(m[1]!.trim());
      }

      // Expect exactly 5 columns: Company | Role | Location | Apply | Age
      if (cells.length !== 5) continue;

      const [companyCell, roleCell, locationCell, applyCell, ageCell] = cells as [string, string, string, string, string];

      // Extract company; a "↳" company cell continues the previous row's company.
      const parsedCompany = this.stripHtml(companyCell).replace(/^[🔥\s]+/, '').trim();
      const resolved = resolveContinuationCompany(parsedCompany, lastCompany);
      lastCompany = resolved.lastCompany;
      if (!resolved.company) continue;
      const company = resolved.company;

      // Role is plain text (may have ↳ for sub-roles under same company)
      const role = this.stripHtml(roleCell).trim();
      if (!role || role === '↳') continue;

      // Skip closed listings
      if (applyCell.toLowerCase().includes('closed') ||
          applyCell.toLowerCase().includes('no longer')) continue;

      // Filter by keywords (role title match)
      const roleLC = role.toLowerCase();
      const matchesKeyword = keywords.length === 0 || keywords.some((kw) => roleLC.includes(kw));
      if (!matchesKeyword) continue;

      // Extract location — may be a <details> block with multiple locations
      const location = this.extractLocation(locationCell);

      // Extract the direct apply URL — first href in the applyCell
      const applyUrl = this.extractFirstUrl(applyCell);
      if (!applyUrl) continue;

      // Parse age: "2d", "1d", "14d" → ISO date
      const postedAt = this.parseAge(ageCell.trim());

      const id = this.generateJobId(company, role, applyUrl);

      jobs.push({
        id,
        title: role,
        company,
        url: applyUrl,
        applyUrl,
        platform: 'swelist',
        location,
        remote: location.toLowerCase().includes('remote'),
        postedAt,
        discoveredAt: new Date().toISOString(),
        jd: `${role} at ${company}\nLocation: ${location}`,
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
    // <details> block: grab text inside <summary> or the first location before <br>
    const detailsMatch = /<summary><strong>(\d+ locations?)<\/strong><\/summary>([\s\S]*?)<\/details>/i.exec(cell);
    if (detailsMatch) {
      // Return first location from the list
      const inner = detailsMatch[2]!.replace(/<br\s*\/?>/gi, '\n');
      const first = this.stripHtml(inner).split('\n')[0]?.trim() ?? '';
      return first || detailsMatch[1]!;
    }
    return this.stripHtml(cell);
  }

  private extractFirstUrl(cell: string): string {
    const match = /href="(https?:\/\/[^"]+)"/i.exec(cell);
    return match ? match[1]! : '';
  }

  private parseAge(raw: string): string {
    // Format: "2d", "14d", "1d"
    const match = /^(\d+)d$/.exec(raw);
    if (match) {
      const daysAgo = parseInt(match[1]!, 10);
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString();
    }
    return new Date().toISOString();
  }
}
