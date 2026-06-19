import { describe, it, expect } from 'vitest';
import { CompanySourcer } from '../../src/outreach/sources/CompanySourcer.js';
import { ArxivSourcer, parseArxivFeed } from '../../src/outreach/sources/ArxivSourcer.js';
import { HunterClient, type HunterFetch } from '../../src/outreach/HunterClient.js';

function hunterReturning(body: unknown): HunterClient {
  const fetchFn: HunterFetch = async () => ({ status: 200, ok: true, json: async () => body });
  return new HunterClient({ apiKey: 'k', fetchFn });
}

describe('CompanySourcer', () => {
  it('maps domain-search emails to candidates and segments recruiters apart', async () => {
    const hunter = hunterReturning({
      data: {
        emails: [
          { value: 'eng@figure.ai', type: 'personal', confidence: 90, first_name: 'Sam', last_name: 'Lee', position: 'ML Engineer' },
          { value: 'jobs@figure.ai', type: 'personal', confidence: 80, first_name: 'Dana', last_name: 'Ng', position: 'Technical Recruiter' },
        ],
      },
    });
    const candidates = await new CompanySourcer(hunter).source({ company: 'Figure AI', domain: 'figure.ai' });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.segment).toBe('industry');
    expect(candidates[0]!.email).toBe('eng@figure.ai');
    expect(candidates[1]!.segment).toBe('recruiter'); // "Recruiter" position
    expect(candidates[1]!.hook).toContain('Figure AI');
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
