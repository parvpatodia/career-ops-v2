/**
 * Sources researchers from the free, keyless arXiv API by topic. arXiv gives the
 * author name, the paper title (the personalization hook), and the abstract URL
 * (the evidence). It does NOT expose emails (arXiv strips them), so these
 * candidates feed the LinkedIn copy-paste pack, and an email is attempted later
 * only if a domain is known. No scraping: this is arXiv's public query API.
 */

import type { Candidate, Segment } from '../types.js';

export type SimpleFetch = (url: string) => Promise<{ text: () => Promise<string> }>;

export interface ArxivQuery {
  /** arXiv search expression, e.g. 'diffusion policy robot manipulation'. */
  query: string;
  /** Default segment for the authors found (researcher unless told otherwise). */
  segment?: Segment;
  maxResults?: number;
}

const ARXIV = 'http://export.arxiv.org/api/query';

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Parse the arXiv Atom feed into one Candidate per paper (first author). Pure. */
export function parseArxivFeed(xml: string, segment: Segment): Candidate[] {
  const out: Candidate[] = [];
  const entries = xml.split('<entry>').slice(1);
  for (const entry of entries) {
    const title = clean((entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''));
    const firstAuthor = clean((entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1] ?? ''));
    const id = clean((entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? ''));
    if (!title || !firstAuthor) continue;
    out.push({
      name: firstAuthor,
      segment,
      org: 'arXiv',
      role: 'author',
      sourceUrl: id || 'https://arxiv.org',
      hook: `your recent paper "${title}"`,
    });
  }
  return out;
}

export class ArxivSourcer {
  constructor(private readonly fetchFn: SimpleFetch = (url) => fetch(url) as unknown as ReturnType<SimpleFetch>) {}

  async source(q: ArxivQuery): Promise<Candidate[]> {
    const max = q.maxResults ?? 5;
    const url =
      `${ARXIV}?search_query=${encodeURIComponent(`all:${q.query}`)}` +
      `&sortBy=submittedDate&sortOrder=descending&start=0&max_results=${max}`;
    const res = await this.fetchFn(url);
    const xml = await res.text();
    return parseArxivFeed(xml, q.segment ?? 'researcher');
  }
}
