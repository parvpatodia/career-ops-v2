/**
 * Best-effort job-description fetcher for auto-tailoring (M9 F3).
 *
 * Most fresh roles are a title + apply link (SWE List / email digests link to
 * simplify.jobs), so genuine résumé tailoring needs the JD pulled from the
 * posting. Simplify and most ATS posting pages are server-rendered, so a plain
 * fetch + strip-to-text captures the JD. JS-only shells yield too little text and
 * return '' — the caller then tailors from the title/company only (never blocks).
 *
 * Noise tolerance: the stripped text carries some page chrome (nav/footer). That
 * is fine downstream: KeywordExtractor ranks by frequency + required-section, and
 * injection is attestation-gated, so chrome words never become a fabricated skill.
 *
 * Pure `extractJdText` (tested off fixtures) + thin `fetchJd` IO (injectable fetch).
 */

import { timeoutFetch } from '../utils/httpFetch.js';

/** A JD below this is treated as "not usable" (a stub or a JS shell). Matches
 *  KeywordExtractor's floor so a fetched JD either helps or is cleanly absent. */
export const MIN_JD_CHARS = 200;

/** Strip a posting page's HTML to readable text. Removes script/style/noscript
 *  blocks first (so SSR JSON + inline CSS never leak in), then tags, then
 *  collapses whitespace. Returns '' when the result is below the usable floor. */
export function extractJdText(html: string): string {
  const text = (html ?? '')
    .replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length >= MIN_JD_CHARS ? text : '';
}

type FetchLike = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

/**
 * Fetch a posting URL and return its JD text, or '' on any failure / too-little
 * text. Never throws (auto-tailoring must not break on one bad URL).
 */
export async function fetchJd(url: string, fetchImpl: FetchLike = timeoutFetch() as unknown as FetchLike): Promise<string> {
  if (!/^https?:\/\//i.test(url ?? '')) return '';
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return '';
    return extractJdText(await res.text());
  } catch {
    return '';
  }
}
