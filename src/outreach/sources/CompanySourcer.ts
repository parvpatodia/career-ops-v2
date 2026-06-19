/**
 * Sources real, emailable people from a target company's domain via Hunter
 * domain-search. This is the reliable auto-send path: Hunter returns names,
 * positions, and addresses for a company domain, no scraping and no LinkedIn.
 * A position that reads like recruiting routes the contact to the recruiter
 * segment; everyone else is industry.
 */

import type { HunterClient } from '../HunterClient.js';
import type { Candidate, Segment } from '../types.js';

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

// Recruiting / talent / HR: the people who actually hire interns.
const RECRUITER = /\b(recruit|recruiter|recruiting|talent|sourcer|hr|human resources|people operations|people ops|university relations|campus|early career)\b/i;
// Explicit non-targets: cold-emailing these about a co-op is noise.
const IRRELEVANT = /\b(administrative|admin assistant|executive assistant|office manager|office administrator|receptionist|finance|financial|accountant|accounting|controller|bookkeep|payroll|sales|account executive|account manager|business development|marketing|brand|communications|public relations|legal|counsel|attorney|paralegal|facilities|procurement|customer success|customer support|community manager)\b/i;
// High-precision technical and leadership signals worth reaching out to.
const RELEVANT = /\b(engineer|engineering|software|swe|machine learning|ml|ai|artificial intelligence|research|scientist|robotic|robotics|perception|autonomy|autonomous|computer vision|deep learning|founder|co-?founder|cto|chief technology|ceo|chief executive|developer|hardware|firmware|embedded|technical staff|member of technical|nlp|llm)\b/i;

/**
 * Classify a Hunter position into an outreach segment, or null to SKIP. Order
 * matters: recruiting wins first, then explicit non-targets are dropped, then
 * technical/leadership roles are kept. Anything else (unknown or ambiguous
 * title, or no title at all) is skipped, because emailing a stranger we cannot
 * place is exactly the noise Parv asked to stop. Conservative by design.
 */
export function classifyRole(position?: string): Segment | null {
  const p = position?.trim();
  if (!p) return null;
  if (RECRUITER.test(p)) return 'recruiter';
  if (IRRELEVANT.test(p)) return null;
  if (RELEVANT.test(p)) return 'industry';
  return null;
}

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
      const position = e.position?.trim();
      const segment = classifyRole(position);
      if (!segment) continue; // skip admins, finance, sales, and unknown roles
      const name = [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || e.value;
      out.push({
        name,
        segment,
        org: target.company,
        role: position,
        email: e.value,
        emailConfidence: e.confidence,
        sourceUrl: `https://${target.domain}`,
        // segment is non-null only when position is known, so the hook always has a role.
        hook: `your work as ${position} at ${target.company}`,
        focus: target.focus,
      });
    }
    return out;
  }
}
