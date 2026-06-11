/**
 * Canonical URL resolver for job application URLs.
 *
 * WHY: The scanner saves the URL of the search results page, not the
 * application form. Every ATS has a different URL pattern. Resolving to
 * the canonical form URL before navigation is the first requirement for
 * successful form filling — if you navigate to the wrong page, every
 * selector fails silently.
 */

export type AtsType = 'greenhouse' | 'lever' | 'workday' | 'linkedin' | 'ashby' | 'handshake' | 'generic';

export interface ResolvedUrl {
  url: string;
  ats: AtsType;
  wasResolved: boolean;
}

export class UrlResolver {
  resolve(rawUrl: string): ResolvedUrl {
    const url = rawUrl.trim();

    // ── Handshake ────────────────────────────────────────────────────────────
    // Search page: job-search/{id}?query=... → posting page: stu/postings/{id}
    const hsSearch = url.match(/joinhandshake\.com\/job-search\/(\d+)/);
    if (hsSearch) {
      return {
        url: `https://app.joinhandshake.com/stu/postings/${hsSearch[1]}`,
        ats: 'handshake',
        wasResolved: true,
      };
    }

    if (url.includes('joinhandshake.com')) {
      return { url, ats: 'handshake', wasResolved: false };
    }

    // ── Greenhouse ───────────────────────────────────────────────────────────
    if (
      url.includes('greenhouse.io') ||
      url.includes('boards.greenhouse') ||
      url.includes('gh_jid=') ||   // custom domain with GH param
      url.includes('gh_src=')
    ) {
      return { url, ats: 'greenhouse', wasResolved: false };
    }

    // ── Lever ────────────────────────────────────────────────────────────────
    if (url.includes('lever.co/')) {
      return { url, ats: 'lever', wasResolved: false };
    }

    // ── Workday ──────────────────────────────────────────────────────────────
    if (url.includes('myworkdayjobs.com') || url.includes('myworkdaysite.com')) {
      return { url, ats: 'workday', wasResolved: false };
    }

    // ── LinkedIn ─────────────────────────────────────────────────────────────
    if (url.includes('linkedin.com/jobs')) {
      return { url, ats: 'linkedin', wasResolved: false };
    }

    // ── Ashby ────────────────────────────────────────────────────────────────
    if (url.includes('ashbyhq.com')) {
      return { url, ats: 'ashby', wasResolved: false };
    }

    // ── Generic fallback ─────────────────────────────────────────────────────
    return { url, ats: 'generic', wasResolved: false };
  }
}
