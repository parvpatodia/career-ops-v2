/**
 * Sources real, emailable people from a target company's domain via Hunter
 * domain-search. This is the reliable auto-send path: Hunter returns names,
 * positions, and addresses for a company domain, no scraping and no LinkedIn.
 * A position that reads like recruiting routes the contact to the recruiter
 * segment; everyone else is industry.
 */

import type { HunterClient } from '../HunterClient.js';
import type { Candidate } from '../types.js';

export interface CompanyTarget {
  /** Company display name, e.g. "Figure AI". */
  company: string;
  /** Email domain, e.g. "figure.ai". */
  domain: string;
  /** Max people to pull per company (Hunter caps at 100). */
  limit?: number;
  /** What the company works on, e.g. "humanoid robots". Drives the relevance line. */
  focus?: string;
}

const RECRUITER = /recruit|talent|sourcer|people ops|people operations|human resources|\bhr\b|hiring|university relations/i;

export class CompanySourcer {
  constructor(private readonly hunter: HunterClient) {}

  async source(target: CompanyTarget): Promise<Candidate[]> {
    const emails = await this.hunter.domainSearch({
      domain: target.domain,
      limit: target.limit ?? 10,
      type: 'personal', // skip info@/jobs@ generic boxes
    });

    const out: Candidate[] = [];
    for (const e of emails) {
      if (!e.value || !e.value.includes('@')) continue;
      const name = [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.value;
      const position = e.position?.trim();
      const segment = position && RECRUITER.test(position) ? 'recruiter' : 'industry';
      out.push({
        name,
        segment,
        org: target.company,
        role: position,
        email: e.value,
        emailConfidence: e.confidence,
        sourceUrl: `https://${target.domain}`,
        hook: position
          ? `your work as ${position} at ${target.company}`
          : `the team at ${target.company}`,
        focus: target.focus,
      });
    }
    return out;
  }
}
