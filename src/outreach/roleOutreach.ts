/**
 * Bridges the job firehose to LinkedIn outreach: turns the fresh on-field roles
 * the watcher catches (data/new-jobs.json) into per-company outreach packs Parv
 * can act on weekly. This is the missing link the manual outreach-targets list
 * did not cover — outreach now follows the roles that are actually open.
 *
 * HONEST + no-automation (invariant 5, and the global "no LinkedIn automation"
 * rule): a pack does NOT invent a person. `searches` are LinkedIn people-search
 * URLs Parv opens and clicks himself; the messages are copy-paste, and every
 * self-claim is grounded in an approved snippet (the same anti-fabrication
 * mechanism the email Drafter uses), never generated. Parv finds the person,
 * pastes, and sends.
 *
 * Pure: takes already-read role seeds + a SnippetBook, returns packs. Unit-tested
 * off fixtures; the CLI (cli/linkedinRoles.ts) supplies the real fresh roles.
 */

import { categorize, type RoleCategory } from '../scanner/categorize.js';
import type { SnippetBook } from './SnippetBook.js';

/** The minimum a fresh role needs to seed a pack (a subset of the UI FreshRole). */
export interface RoleSeed {
  company: string;
  role: string;
  category?: string;
  applyUrl?: string;
}

/** One LinkedIn people-search for a company. Parv opens the URL and clicks. */
export interface OutreachSearch {
  label: string;
  url: string;
}

/** A per-company LinkedIn outreach pack tied to that company's fresh roles. */
export interface RoleOutreachPack {
  company: string;
  /** Distinct role titles this company is hiring for (newest first, capped). */
  roles: string[];
  category: RoleCategory;
  /** The freshest posting link for reference (the top role's apply URL). */
  applyUrl?: string;
  /** People-searches to run (recruiter + engineer), no fabricated names. */
  searches: OutreachSearch[];
  /** Copy-paste connection-request note, guaranteed <= LINKEDIN_NOTE_MAX chars. */
  connectionNote: string;
  /** Longer copy-paste follow-up for after they accept / an InMail. */
  followUp: string;
  /** Ready-to-send cold email (subject + body), grounded in approved snippets,
   *  recipient-agnostic. Parv sends it once he has the address (no automation,
   *  no Hunter dependency). Framing is StyleLinter-clean (guarded by test). */
  coldEmail: { subject: string; body: string };
}

export interface RolePackOptions {
  /** Cap distinct companies (a weekly batch, not the whole list). Default 15. */
  maxCompanies?: number;
  /** Cap role titles listed per company. Default 3. */
  maxRolesPerCompany?: number;
}

/**
 * LinkedIn caps a connection-request note near 300 chars; over that, the send
 * silently truncates. We guarantee the note fits so nothing is cut mid-word.
 */
export const LINKEDIN_NOTE_MAX = 300;

/** True identity fallback (matches config/profile.yml) when no snippet is set;
 *  factual, not a fabricated accomplishment. Mirrors Drafter.linkedin(). */
const DEFAULT_INTRO = "I'm an MS AI student at Northeastern.";

/** The engineer people-search keyword per category (recruiters are separate). */
const ENGINEER_KEYWORD: Record<RoleCategory, string> = {
  'AI/ML': 'machine learning engineer',
  'Robotics/AV': 'robotics engineer',
  Data: 'data scientist',
  Software: 'software engineer',
  Other: 'engineer',
};

const peopleSearch = (keywords: string): string =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;

/** A term/season label ("Fall 2026", "Summer 2026", a bare year) that an email
 *  parser sometimes mis-captures into the company field — never a real company. */
const TERM_LABEL = /^(fall|spring|summer|winter|autumn)?\s*20\d\d$|^(fall|spring|summer|winter|autumn)\s+20\d\d$/i;

/** A blank, placeholder ("(via email:...)"), or term-label company is not an
 *  outreach target — you cannot search LinkedIn for "(via ...)" or "Fall 2026".
 *  Read-boundary hygiene: the hot-list persists across watcher builds, so a junk
 *  company written by an older ingestion must be rejected here, not trusted. */
const isRealCompany = (company: string): boolean => {
  const c = company.trim();
  return c.length > 0 && !/^\(via\b/i.test(c) && !TERM_LABEL.test(c);
};

const normCompany = (company: string): string => company.trim().toLowerCase();

/** Compose a connection note guaranteed to fit LINKEDIN_NOTE_MAX. Prefers the
 *  grounded intro; drops it, then hard-truncates, only if a long company/role
 *  would overflow — so the note is never cut mid-sentence by LinkedIn. */
function connectionNote(company: string, role: string, intro: string): string {
  const withIntro = `Hi! I saw ${company} is hiring for ${role}. ${intro} Would love to connect and hear about the team.`;
  if (withIntro.length <= LINKEDIN_NOTE_MAX) return withIntro;
  const short = `Hi! I saw ${company}'s ${role} opening and would love to connect and learn more about the team.`;
  if (short.length <= LINKEDIN_NOTE_MAX) return short;
  return short.slice(0, LINKEDIN_NOTE_MAX - 1).trimEnd() + '…';
}

function followUp(company: string, role: string, intro: string): string {
  return (
    `Hi there, thanks for connecting! I'm applying to ${company}'s ${role} and I'm really interested in the team. ` +
    `${intro} If you have any tips on the process, or could point me to the right person, I'd appreciate it. Thanks!`
  );
}

/**
 * A recipient-agnostic cold email grounded in approved snippets. Self-claims come
 * ONLY from resolved snippets (industry.* — omitted, never invented, if absent);
 * the generated framing (greeting, role line, close) is deliberately free of the
 * banned StyleLinter vocabulary. It does NOT assert an attached resume (LESSONS
 * 2026-06-19: a body must not claim a file it lacks) — Parv attaches + sends.
 */
function coldEmail(
  company: string,
  role: string,
  snippets: SnippetBook
): { subject: string; body: string } {
  const intro = snippets.resolve('industry.intro') ?? snippets.resolve('linkedin.intro') ?? DEFAULT_INTRO;
  const detail = snippets.resolve('industry.detail');
  const coop = snippets.resolve('industry.coop');
  const signature = snippets.resolve('common.signature') ?? 'Parv';

  const parts = [
    `Hi there,`,
    `I'm reaching out about ${company}'s ${role}. ${intro}`,
    detail,
    coop,
    `I can share my resume and walk through my background if that is useful. Thanks for your time.`,
    signature,
  ].filter((p): p is string => !!p && p.trim() !== '');

  return { subject: `Interested in ${company}'s ${role} (Fall 2026)`, body: parts.join('\n\n') };
}

/**
 * Group fresh roles by company and build one LinkedIn outreach pack per company,
 * newest company first (input is expected newest-first). Roles are de-duped and
 * capped per company; companies are capped for a weekly batch.
 */
export function roleOutreachPacks(
  roles: readonly RoleSeed[],
  snippets: SnippetBook,
  opts: RolePackOptions = {}
): RoleOutreachPack[] {
  const maxCompanies = opts.maxCompanies ?? 15;
  const maxRolesPerCompany = opts.maxRolesPerCompany ?? 3;
  const intro = snippets.resolve('linkedin.intro') ?? DEFAULT_INTRO;

  // Preserve first-seen order (newest first) while grouping.
  const order: string[] = [];
  const byCompany = new Map<string, { company: string; roles: string[]; applyUrl?: string }>();
  for (const r of roles) {
    if (!isRealCompany(r.company ?? '')) continue;
    const role = (r.role ?? '').trim();
    if (!role) continue;
    const key = normCompany(r.company);
    let entry = byCompany.get(key);
    if (!entry) {
      entry = { company: r.company.trim(), roles: [], applyUrl: r.applyUrl };
      byCompany.set(key, entry);
      order.push(key);
    }
    // De-dupe role titles case-insensitively; keep the first (freshest) apply URL.
    if (!entry.roles.some((x) => x.toLowerCase() === role.toLowerCase())) {
      entry.roles.push(role);
    }
  }

  const packs: RoleOutreachPack[] = [];
  for (const key of order) {
    if (packs.length >= maxCompanies) break;
    const entry = byCompany.get(key)!;
    const roleList = entry.roles.slice(0, maxRolesPerCompany);
    const topRole = roleList[0]!;
    const category = categorize(topRole);
    packs.push({
      company: entry.company,
      roles: roleList,
      category,
      applyUrl: entry.applyUrl,
      searches: [
        { label: 'Recruiters / university relations', url: peopleSearch(`${entry.company} university recruiter`) },
        { label: `${ENGINEER_KEYWORD[category]}s`, url: peopleSearch(`${entry.company} ${ENGINEER_KEYWORD[category]}`) },
      ],
      connectionNote: connectionNote(entry.company, topRole, intro),
      followUp: followUp(entry.company, topRole, intro),
      coldEmail: coldEmail(entry.company, topRole, snippets),
    });
  }
  return packs;
}
