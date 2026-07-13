/**
 * Canonicalizes a raw application URL before the apply step navigates.
 *
 * Two jobs, both aimed at turning an aggregator link into a first-party ATS form
 * the verified filler can actually submit:
 *
 *  1) Strip aggregator/tracking query params. Every SWEList/NewGrad link is
 *     Simplify-wrapped (utm_source=Simplify&ref=Simplify, gh_src=...). Those
 *     params are noise to the ATS ref parsers and the DOM navigation; drop them
 *     so the clean posting URL shows through. (gh_jid is KEPT — it identifies
 *     the job.)
 *
 *  2) Resolve an EMBEDDED Greenhouse posting. Company career pages embed a
 *     Greenhouse board as company.com/careers?gh_jid=NNN; the board TOKEN is not
 *     in that URL, so parseGreenhouseRef can't fetch the schema and the DOM form
 *     lives in an iframe the generic filler can't reach (the 2026-07-12 Blue
 *     River fill timeout). We fetch the embedding page ONCE, read the token from
 *     the Greenhouse embed script (boards.greenhouse.io/embed/job_board/js?for=
 *     <token>), and rewrite to the bare first-party APPLICATION FORM,
 *     job-boards.greenhouse.io/embed/job_app?for=<token>&token=NNN. WHY the
 *     /embed/job_app form and not /<token>/jobs/NNN: an embed-configured company
 *     (Blue River) redirects the /jobs/NNN board URL straight back to its own
 *     iframe page, so the fields are never top-level; /embed/job_app renders the
 *     bare form with visible, fillable fields and does not redirect. The board-
 *     API schema fetch parses this form URL too (parseGreenhouseRef).
 *
 * WHY graceful (never throws): a failed resolution returns the param-stripped
 * URL unchanged, so the existing generic fallback + verify-or-abstain still
 * apply. A canonicalizer must only ever IMPROVE the URL, never break the path.
 */

// Query-param keys dropped as tracking noise (compared lower-cased). gh_jid is
// deliberately NOT here: it names the Greenhouse job and is load-bearing.
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'source', 'src', 'gh_src',
]);

/** Minimal fetch surface for reading a page's HTML (real `fetch` satisfies it). */
export type HtmlFetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** Remove tracking params; return the cleaned URL (or the trimmed input if unparseable). */
export function stripTrackingParams(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const u = new URL(trimmed);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

/** The numeric gh_jid on a Greenhouse-embed URL, or null. */
export function parseGhJid(rawUrl: string): string | null {
  try {
    const jid = new URL(rawUrl.trim()).searchParams.get('gh_jid');
    return jid && /^\d+$/.test(jid) ? jid : null;
  } catch {
    return null;
  }
}

/** True when the URL is already a first-party Greenhouse board posting. */
export function isCanonicalGreenhouse(url: string): boolean {
  return /(?:job-)?boards\.greenhouse\.io\/[^/?#]+\/jobs\/\d+/i.test(url);
}

/**
 * The bare first-party Greenhouse APPLICATION FORM for a board token + job id.
 * Greenhouse's confusing param names: `for` is the board token, `token` the job
 * id. This endpoint renders visible top-level fields and never redirects to a
 * company embed page, so it is the reliable fill target.
 */
export function greenhouseEmbedAppUrl(token: string, jobId: string): string {
  return `https://job-boards.greenhouse.io/embed/job_app?for=${token}&token=${jobId}`;
}

/**
 * Read the Greenhouse board token from an embedding page's HTML. The embed
 * script is boards.greenhouse.io/embed/job_board/js?for=<token>; a bare
 * ...?for=<token> is the fallback for other embed variants.
 */
export function extractGreenhouseEmbedToken(html: string): string | null {
  const m =
    html.match(/greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i) ||
    html.match(/[?&]for=([a-z0-9_-]+)/i);
  return m ? m[1]! : null;
}

export class UrlCanonicalizer {
  constructor(private readonly fetchFn: HtmlFetchLike = fetch as unknown as HtmlFetchLike) {}

  async canonicalize(rawUrl: string): Promise<string> {
    const clean = stripTrackingParams(rawUrl);

    // Already a first-party Greenhouse posting: nothing to resolve.
    if (isCanonicalGreenhouse(clean)) return clean;

    // Only an embedded-Greenhouse URL (gh_jid present) needs a page fetch.
    const jid = parseGhJid(clean);
    if (!jid) return clean;

    try {
      const res = await this.fetchFn(clean);
      if (!res.ok) return clean;
      const token = extractGreenhouseEmbedToken(await res.text());
      return token ? greenhouseEmbedAppUrl(token, jid) : clean;
    } catch {
      return clean;
    }
  }
}
