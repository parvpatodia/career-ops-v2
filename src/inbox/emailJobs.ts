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
const NONUS = /(india|bengaluru|bangalore|hyderabad|pune|gurgaon|noida|\blondon\b|\buk\b|united kingdom|canada|toronto|vancouver|singapore|dublin|ireland|berlin|germany|paris|france|amsterdam|netherlands|tokyo|japan|sydney|australia|tel aviv|israel|brazil|mexico|poland|spain|portugal)/i;
// A hostname/path that plausibly points at a real job posting.
const JOB_URL = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com|jobs\.|careers?\.|\/jobs?\/|\/careers?\/|gh_jid=|linkedin\.com\/jobs|smartrecruiters\.com|icims\.com|bamboohr\.com)/i;
const SKIP_URL = /(unsubscribe|mailto:|\.(png|jpg|jpeg|gif|svg)(\?|$)|facebook\.com|twitter\.com|x\.com|instagram\.com|linkedin\.com\/(company|in)\b|\/privacy|\/terms|utm_medium=email#)/i;

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const stripTags = (s: string): string => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

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
  return !INELIGIBLE_KEYWORDS.some((kw) => hay.includes(kw)) && !NONUS.test(hay);
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
    for (const m of msg.bodyHtml.matchAll(anchor)) {
      const url = decodeEntities(m[1]!).trim();
      const text = stripTags(m[2]!);
      if (!url || text.length < 4) continue;
      // Only real web links — never javascript:/data:/relative (which would
      // become an unsafe href in the local UI, and can't be a real posting).
      if (!/^https?:\/\//i.test(url)) continue;
      if (SKIP_URL.test(url)) continue;
      // Keep a link only if it looks like a job AND the visible text reads as an
      // on-field, junior role (drops nav/footer/marketing anchors, off-field
      // interns like "Mechanical Engineering Intern", and senior on-field roles).
      const looksJob = JOB_URL.test(url);
      if (!looksJob || !isRelevantRole(text) || !JR.test(text)) continue;
      if (!eligible(text)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      const { role, company } = splitRoleCompany(text);
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
  existing: Array<{ id?: string }>,
  cap = 200
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const merged: Array<Record<string, unknown>> = [];
  for (const j of [...incoming, ...existing]) {
    const id = String((j as { id?: string }).id ?? '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(j as Record<string, unknown>);
  }
  return merged.slice(0, cap);
}
