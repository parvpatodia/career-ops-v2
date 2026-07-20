/**
 * Parse job-alert digest emails (Scalar + other daily intern senders) into the
 * same FreshRole shape the watcher's hot-list uses, so aggregator postings show
 * up in the command-center UI beside the board-API roles. These aggregators
 * already scraped LinkedIn/Indeed/Handshake, so this is the safe way to surface
 * those without scraping the sites directly.
 *
 * PURE + injectable: takes already-fetched email messages (fetched via the ms365
 * MCP when Claude is active — a plain headless node loop cannot call MCP, so this
 * is NOT part of the 60s watch; it refreshes on an active session). No network,
 * no MCP dependency here, so the extraction logic is unit-tested off a fixture.
 *
 * SAFETY: freshness (invariant 9) is enforced at the APPLY pipeline, not here —
 * an email rarely carries the real POSTING date, only the email's received date.
 * So these are surfaced as candidates (the UI is a launcher); applying still runs
 * FreshnessFilter, which abstains on an unparseable posting date. F-1-ineligible
 * (clearance/ITAR/US-person) and off-field/non-junior roles are dropped here.
 */

import crypto from 'crypto';
import { isRelevantRole, INELIGIBLE_KEYWORDS } from '../orchestrator/queuePlanning.js';
import { categorize } from '../scanner/categorize.js';
import { isLikelyNonUS } from '../utils/locations.js';

export interface EmailMessage {
  from: string;
  subject: string;
  receivedDateTime: string;
  bodyHtml: string;
}

export interface EmailJob {
  id: string;
  company: string;
  role: string;
  applyUrl: string;
  platform: string; // "email:<sender-slug>"
  postedAt: string; // email received time (a proxy; NOT the posting date)
  caughtAt: string;
  category: string;
  location: string;
  source: string; // sender address
}

const JR = /(intern|co-?op|new ?grad|new graduate|university grad|early career|entry[- ]level|graduate (engineer|software))/i;
// A hostname/path that plausibly points at a real job posting.
const JOB_URL = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com|simplify\.jobs\/p\/|jobs\.|careers?\.|\/jobs?\/|\/careers?\/|gh_jid=|linkedin\.com\/jobs|linkedin\.com\/comm\/jobs|smartrecruiters\.com|icims\.com|bamboohr\.com)/i;
const SKIP_URL = /(unsubscribe|mailto:|\.(png|jpg|jpeg|gif|svg)(\?|$)|facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com\/(company|in)\b|\/privacy|\/terms|utm_medium=email#)/i;

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&middot;|&bull;/g, '·').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&rsquo;|&lsquo;/g, "'").replace(/&hellip;/g, '…')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// Decode known entities, drop any leftover named entities, collapse whitespace.
const stripTags = (s: string): string =>
  decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/&[a-zA-Z]+;/g, ' ').replace(/\s+/g, ' ').trim();

// A bold label is only a company if it is NOT a salary/badge/location chip
// (LinkedIn alerts put "$6K / year", "(On-site)" etc. in bold before the link).
const looksLikeCompany = (s: string): boolean =>
  /[a-z]/i.test(s) &&
  !/(\$|\/\s*(yr|year|hour|hr|mo)|\bon-?site\b|\bremote\b|\bhybrid\b|per\s|salary|\bnew\b|\bapply\b|\d{3,})/i.test(s) &&
  // A season/term label ("Fall 2026", "Summer") is a posting attribute, not a company.
  !/^(fall|spring|summer|winter|autumn)(\s+20\d\d)?$/i.test(s.trim());

const mkId = (url: string): string => `email-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 8)}`;

// Canonical dedup key: collapse a LinkedIn posting's many tracking URLs to its
// numeric job id, so the clean text-block version and the HTML card anchor of
// the SAME job dedup to one. Non-LinkedIn falls back to the path (no query).
const canonUrl = (url: string): string => {
  const m = url.match(/jobs\/view\/(\d+)/);
  return m ? `li:${m[1]}` : url.split('?')[0]!;
};

/**
 * Aggregator digests (Runway, RippleMatch, Getro-powered lists, mailer click
 * trackers) wrap the real posting in a redirect whose destination is an encoded
 * URL in a query param. If the OUTER url is not itself a job URL but a param holds
 * an encoded job URL, return that inner URL; otherwise return the url unchanged.
 * Only activates on non-job outer URLs, so existing direct links are untouched.
 */
export function unwrapTracker(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  // Test the base (origin + path, query stripped): a tracker's ENCODED inner URL
  // sits in the query and would false-match JOB_URL on the full string. If the
  // base itself is a job URL, it is a direct posting, keep it (query and all).
  if (JOB_URL.test(u.origin + u.pathname)) return url;
  for (const [, raw] of u.searchParams) {
    if (!raw) continue;
    let inner = raw;
    try {
      inner = decodeURIComponent(raw);
    } catch {
      /* keep the raw value */
    }
    if (/^https?:\/\//i.test(inner) && JOB_URL.test(inner) && !SKIP_URL.test(inner)) return inner;
  }
  return url;
}

const senderSlug = (from: string): string =>
  (from.split('@')[1] ?? from).split('.')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '') || 'email';

/**
 * Split anchor text like "ML Engineer Intern at Waymo" / "Waymo — ML Intern"
 * / "Waymo | ML Intern" into { role, company }. Best-effort: when there is no
 * separator, the whole text is the role and the company is left blank (the UI
 * still shows the role + the source).
 */
export function splitRoleCompany(text: string): { role: string; company: string } {
  const atMatch = text.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch) return { role: atMatch[1]!.trim(), company: atMatch[2]!.trim() };
  const sep = text.match(/^(.*?)\s*[|–—-]\s*(.+)$/); // Company - Role  OR  Role - Company
  if (sep) {
    const [, a, b] = sep;
    // The side that looks like a role (matches on-field/junior) is the role.
    if (isRelevantRole(b!) || JR.test(b!)) return { role: b!.trim(), company: a!.trim() };
    return { role: a!.trim(), company: b!.trim() };
  }
  return { role: text.trim(), company: '' };
}

function eligible(text: string): boolean {
  const hay = text.toLowerCase();
  return !INELIGIBLE_KEYWORDS.some((kw) => hay.includes(kw)) && !isLikelyNonUS(text);
}

/**
 * Extract on-field, junior, US, F-1-eligible job links from a batch of digest
 * emails. Dedups by apply URL. `now` is injectable for deterministic tests.
 */
export function parseJobEmails(messages: EmailMessage[], now: Date = new Date()): EmailJob[] {
  const caughtAt = now.toISOString();
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out: EmailJob[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    const platform = `email:${senderSlug(msg.from)}`;

    // LinkedIn job-alert layout (text part): "Role\nCompany\nLocation\nView job:
    // <url>". This gives CLEAN role/company/location, unlike the HTML card anchor
    // where they are mashed into one string. Run FIRST so it wins the dedup.
    // Cheap guard: only run this scan on emails that actually contain the marker
    // (skips the regex — and any backtracking cost — on every non-LinkedIn mail).
    const viewBlocks = msg.bodyHtml.includes('View job:')
      ? msg.bodyHtml.matchAll(
          /(?:^|\n)[ \t>]*([^\n]{3,90}?)[ \t]*\n[ \t>]*([^\n]{2,60}?)[ \t]*\n[ \t>]*([^\n]{2,60}?)[ \t]*\n[ \t>]*View job:[ \t]*(https?:\/\/\S+)/g
        )
      : [];
    for (const vm of viewBlocks) {
      const url = decodeEntities(vm[4]!).replace(/[)\].,]+$/, '').trim();
      const role = stripTags(vm[1]!);
      const company = stripTags(vm[2]!);
      const location = stripTags(vm[3]!);
      if (!JOB_URL.test(url) || SKIP_URL.test(url)) continue;
      if (!isRelevantRole(role) || !JR.test(role)) continue;
      if (!eligible(`${role} ${location}`)) continue;
      const key = canonUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: mkId(url), company: company || `(via ${platform})`, role, applyUrl: url,
        platform, postedAt: msg.receivedDateTime, caughtAt,
        category: categorize(role), location, source: msg.from,
      });
    }

    for (const m of msg.bodyHtml.matchAll(anchor)) {
      const rawUrl = decodeEntities(m[1]!).trim();
      const text = stripTags(m[2]!);
      if (!rawUrl || text.length < 4) continue;
      // Only real web links — never javascript:/data:/relative (which would
      // become an unsafe href in the local UI, and can't be a real posting).
      if (!/^https?:\/\//i.test(rawUrl)) continue;
      // Aggregator digests (Runway, RippleMatch, Getro-powered lists) wrap the
      // real posting in a click-tracker; use the inner job URL when present so
      // the posting is captured AND the apply link is the real one, not the tracker.
      const url = unwrapTracker(rawUrl);
      if (SKIP_URL.test(url)) continue;
      // The role is the anchor text up to the first "·" (LinkedIn alerts append
      // "· Location (On-site)"); SWE List anchors have no "·" so this is a no-op.
      const coreText = (text.split('·')[0] ?? text).trim();
      // Keep a link only if it looks like a job AND the visible text reads as an
      // on-field, junior role (drops nav/footer/marketing anchors, off-field
      // interns like "Mechanical Engineering Intern", and senior on-field roles).
      const looksJob = JOB_URL.test(url);
      if (!looksJob || !isRelevantRole(coreText) || !JR.test(coreText)) continue;
      if (!eligible(coreText)) continue;
      const key = canonUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);

      // SWE List / digest layout: "<strong>Company:</strong> <a>Role</a>". If a
      // bold label just before this anchor looks like a company (not a salary/
      // badge chip), trust it and keep the full role text.
      let role = coreText;
      let company = '';
      let strongCompany = '';
      if (typeof m.index === 'number') {
        const before = msg.bodyHtml.slice(Math.max(0, m.index - 200), m.index);
        const labels = [...before.matchAll(/<(?:strong|b)>\s*([^<]{2,60}?)\s*:?\s*<\/(?:strong|b)>/gi)];
        const last = labels[labels.length - 1];
        if (last) strongCompany = stripTags(last[1]!).replace(/:$/, '').trim();
      }
      if (strongCompany && looksLikeCompany(strongCompany)) {
        company = strongCompany;
      } else {
        ({ role, company } = splitRoleCompany(coreText));
      }
      out.push({
        id: `email-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 8)}`,
        company: company || '(via ' + platform + ')',
        role: role || text,
        applyUrl: url,
        platform,
        postedAt: msg.receivedDateTime,
        caughtAt,
        category: categorize(role || text),
        location: '',
        source: msg.from,
      });
    }
  }
  return out;
}

/**
 * Merge freshly-parsed email jobs into the existing hot-list (data/new-jobs.json),
 * newest first, de-duped by id, capped. Pure so the merge is unit-tested; the
 * caller (an active Claude session with MCP) reads/writes the file. Shape matches
 * the watcher's entries so the UI renders both identically.
 */
export function mergeHotlist(
  incoming: EmailJob[],
  existing: Array<{ id?: string; company?: string; role?: string }>,
  cap = 200
): Array<Record<string, unknown>> {
  const seenId = new Set<string>();
  const seenCR = new Set<string>();
  const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const merged: Array<Record<string, unknown>> = [];
  // Incoming (email) first, then existing (board/scanner). Dedup by id AND by
  // company|role, so an email role that duplicates a board role (SWE List links
  // to Simplify, which the scanner already sources) is not shown twice.
  for (const j of [...incoming, ...existing]) {
    const rec = j as { id?: string; company?: string; role?: string };
    const id = String(rec.id ?? '');
    const cr = `${norm(rec.company)}|${norm(rec.role)}`;
    if (id && seenId.has(id)) continue;
    if (cr !== '|' && seenCR.has(cr)) continue;
    if (id) seenId.add(id);
    if (cr !== '|') seenCR.add(cr);
    merged.push(j as Record<string, unknown>);
  }
  return merged.slice(0, cap);
}
