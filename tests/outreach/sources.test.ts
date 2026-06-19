import { describe, it, expect } from 'vitest';
import { CompanySourcer, classifyRole } from '../../src/outreach/sources/CompanySourcer.js';
import { ArxivSourcer, parseArxivFeed } from '../../src/outreach/sources/ArxivSourcer.js';
import { HunterClient, type HunterFetch } from '../../src/outreach/HunterClient.js';

function hunterReturning(body: unknown): HunterClient {
  const fetchFn: HunterFetch = async () => ({ status: 200, ok: true, json: async () => body });
  return new HunterClient({ apiKey: 'k', fetchFn });
}

describe('classifyRole (relevance filter)', () => {
  it('keeps technical and leadership roles as industry', () => {
    for (const t of ['ML Engineer', 'Software Engineer', 'Research Scientist', 'Director of Network Engineering', 'Head of AI', 'CTO', 'Founder', 'Member of Technical Staff', 'Robotics Engineer']) {
      expect(classifyRole(t)).toBe('industry');
    }
  });
  it('routes recruiting and HR to recruiter', () => {
    for (const t of ['Technical Recruiter', 'Talent Acquisition', 'University Relations', 'HR Business Partner', 'Campus Recruiter']) {
      expect(classifyRole(t)).toBe('recruiter');
    }
  });
  it('skips admins, finance, sales, and other non-targets', () => {
    for (const t of ['Administrative Assistant', 'Executive Assistant', 'Office Manager', 'Staff Accountant', 'Account Executive', 'Sales Director', 'Marketing Manager', 'Legal Counsel', 'Director of Partnerships']) {
      expect(classifyRole(t)).toBeNull();
    }
  });
  it('skips a missing or unknown role rather than guessing', () => {
    expect(classifyRole(undefined)).toBeNull();
    expect(classifyRole('')).toBeNull();
    expect(classifyRole('Program Manager')).toBeNull(); // ambiguous: skip
  });
  it('does not false-match a banned token inside a word (email/retail)', () => {
    expect(classifyRole('Retail Associate')).toBeNull();
  });
});

describe('CompanySourcer', () => {
  it('maps relevant emails to candidates, segments recruiters apart, and drops irrelevant roles', async () => {
    const hunter = hunterReturning({
      data: {
        emails: [
          { value: 'eng@figure.ai', type: 'personal', confidence: 90, first_name: 'Sam', last_name: 'Lee', position: 'ML Engineer' },
          { value: 'jobs@figure.ai', type: 'personal', confidence: 80, first_name: 'Dana', last_name: 'Ng', position: 'Technical Recruiter' },
          { value: 'admin@figure.ai', type: 'personal', confidence: 99, first_name: 'Pat', last_name: 'Ito', position: 'Administrative Assistant' },
          { value: 'noidea@figure.ai', type: 'personal', confidence: 70, first_name: 'No', last_name: 'Role' }, // no position
        ],
      },
    });
    const candidates = await new CompanySourcer(hunter).source({ company: 'Figure AI', domain: 'figure.ai' });
    expect(candidates.map((c) => c.email)).toEqual(['eng@figure.ai', 'jobs@figure.ai']); // admin + no-role dropped
    expect(candidates[0]!.segment).toBe('industry');
    expect(candidates[1]!.segment).toBe('recruiter');
    expect(candidates[0]!.hook).toContain('Figure AI');
  });
});

describe('ArxivSourcer', () => {
  const FEED = `<?xml version="1.0"?><feed>
    <entry>
      <id>http://arxiv.org/abs/2501.00001v1</id>
      <title>Diffusion Policies for Dexterous Manipulation</title>
      <author><name>Jane Researcher</name></author>
      <author><name>Second Author</name></author>
    </entry>
    <entry>
      <id>http://arxiv.org/abs/2501.00002v1</id>
      <title>Planning for Autonomous Driving</title>
      <author><name>Carlos Author</name></author>
    </entry>
  </feed>`;

  it('parses the Atom feed into one candidate per paper (first author + title hook)', () => {
    const cands = parseArxivFeed(FEED, 'researcher');
    expect(cands).toHaveLength(2);
    expect(cands[0]!.name).toBe('Jane Researcher');
    expect(cands[0]!.hook).toContain('Diffusion Policies for Dexterous Manipulation');
    expect(cands[0]!.sourceUrl).toContain('arxiv.org/abs/2501.00001');
    expect(cands[0]!.email).toBeUndefined(); // arXiv exposes no email
  });

  it('source() hits the query API and returns parsed candidates', async () => {
    let calledUrl = '';
    const sourcer = new ArxivSourcer(async (url) => { calledUrl = url; return { text: async () => FEED }; });
    const cands = await sourcer.source({ query: 'diffusion policy', maxResults: 2 });
    expect(calledUrl).toContain('export.arxiv.org');
    expect(calledUrl).toContain('diffusion');
    expect(cands).toHaveLength(2);
  });
});
