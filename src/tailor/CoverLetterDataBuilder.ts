/**
 * Builds the cover-letter specifics (the four {{PARA_*}} paragraphs the template
 * expects) from Parv's REAL profile + the target role/company/category. This is
 * the "grounded template + specifics" path (Parv's confirmed M9 choice): every
 * claim is a real profile fact, never generated, so the CoverLetterBuilder's
 * verify-or-abstain gate has real material to pass.
 *
 * Two anti-fabrication rules live here:
 *  - Self-claims come ONLY from profile narrative/projects (never invented). If a
 *    fact is absent, the paragraph degrades to a shorter grounded one, never a
 *    made-up one.
 *  - Dashes in profile prose are normalized to commas (the cover-letter style
 *    bans em/en dashes; Parv's best_achievement contains one). This is FORMATTING
 *    only, it never changes wording. Banned WORDS are NOT scrubbed (that would
 *    change meaning) so the CoverLetterVerifier stays the honest backstop.
 *
 * Pure + injectable (a minimal ProfileFacts interface, not the concrete loader)
 * so it is unit-tested without reading real PII.
 */

import type { CoverLetterData } from './CoverLetterBuilder.js';

/** The slice of ProfileLoader this builder needs (depend on the interface). */
export interface ProfileFacts {
  getNarrative(): { superpower: string; excites: string; bestAchievement: string };
  getProjects(): Array<{ name: string; summary: string; stack: string[] }>;
  getSkills(): string[];
}

export interface RoleContext {
  company: string;
  role: string;
  category: string;
  /** Optional JD text; when present, an honest skill intersection sharpens para 1. */
  jd?: string;
}

/** Category -> the domain phrase used when there is no JD skill hook. */
const DOMAIN: Record<string, string> = {
  'AI/ML': 'applied machine learning',
  'Robotics/AV': 'robotics and autonomy',
  Data: 'data and analytics',
  Software: 'software systems',
  Other: 'engineering',
};

/** Any dash used as punctuation (em/en/horizontal-bar/"--") -> a comma. The
 *  cover-letter style bans dashes and profile prose may contain them. Formatting
 *  only. */
export const normalizeDashes = (s: string): string =>
  (s ?? '')
    .replace(/\s*(?:[–—―]|--)\s*/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .trim();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class CoverLetterDataBuilder {
  constructor(private readonly profile: ProfileFacts) {}

  build(ctx: RoleContext): CoverLetterData {
    const n = this.profile.getNarrative();
    const top = this.profile.getProjects()[0];
    const excites = normalizeDashes(n.excites);
    const superpower = normalizeDashes(n.superpower);
    const hook = this.jdSkillHook(ctx.jd) ?? DOMAIN[ctx.category] ?? 'engineering';

    const companySpecificAngle =
      `I am applying for the ${ctx.role} role at ${ctx.company}. ${excites} ` +
      `Work close to ${hook} is exactly where I want to build.`;

    const strongestProject = top
      ? `My strongest project is ${top.name}: ${normalizeDashes(top.summary)}` +
        (top.stack.length ? ` (built with ${top.stack.slice(0, 6).join(', ')}).` : '.')
      : normalizeDashes(n.bestAchievement);

    const experienceAlignment = `${superpower} That maps directly to what the ${ctx.role} needs.`;

    const closing =
      `I would welcome the chance to bring this to ${ctx.company}. ` +
      `Thank you for your time and consideration.`;

    return {
      company: ctx.company,
      role: ctx.role,
      companySpecificAngle,
      strongestProject,
      experienceAlignment,
      closing,
    };
  }

  /**
   * A skill named in BOTH the JD and Parv's profile (whole-word, case-insensitive).
   * An honest intersection, never a skill he lacks. Null when there is no JD or no
   * overlap, so the caller falls back to the category domain.
   */
  private jdSkillHook(jd?: string): string | null {
    const text = (jd ?? '').toLowerCase();
    if (text.length < 50) return null;
    for (const skill of this.profile.getSkills()) {
      const s = skill.trim();
      if (s.length < 3) continue; // avoid 1-2 char false hits ("R", "Go" handled elsewhere)
      if (new RegExp(`\\b${escapeRe(s.toLowerCase())}\\b`).test(text)) return s;
    }
    return null;
  }
}
