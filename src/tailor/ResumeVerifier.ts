/**
 * The independent CHECKER for a tailored resume (maker/checker split, AGENTS.md
 * invariant 2; the resume analogue of the form Verifier). It parses the
 * RENDERED output back and diffs it against what was intended — it never shares
 * the renderer's filling logic, so a render bug cannot hide behind the same code
 * that produced it.
 *
 * Five properties, any one failing => the verdict fails and the caller abstains
 * (verify-or-abstain): a damaged or dishonest resume is never shipped.
 *   1. every required template section is present
 *   2. contact info matches profile.yml (the single source of truth)
 *   3. every claimed/injected keyword actually appears
 *   4. no template placeholder ({{...}}) leaked into the output
 *   5. visible length is within the page budget
 *
 * Pure and deterministic. Keyword presence uses the SAME whole-token matcher as
 * the extractor and planner (src/tailor/text.ts) so the checker cannot disagree
 * with the maker about whether a keyword "appears".
 */

import { containsTerm, leakedPlaceholders } from './text.js';

export interface ContactFacts {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  portfolio: string | null;
  location: string;
}

export interface ResumeCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ResumeVerdict {
  pass: boolean;
  checks: ResumeCheck[];
}

export interface VerifyResumeInput {
  /** The exact HTML that becomes the PDF. */
  renderedHtml: string;
  identity: ContactFacts;
  requiredSections: string[];
  claimedKeywords: string[];
  budget?: { maxVisibleChars?: number };
}

// ~1.5 pages of single-column body text. The hard page-count gate is the PDF
// render step (thin IO); this is the deterministic pure proxy that catches a
// resume that ballooned before we ever launch a browser.
const DEFAULT_MAX_VISIBLE_CHARS = 7000;

// A real resume has at least a summary, experience, education, and skills. The
// per-section presence check below is true-by-construction for sections that
// came from the same markdown (a regression guard), so this independent
// structural floor is what actually catches a near-empty / malformed CV (e.g.
// one with no "## " headers, which would otherwise leak its raw preamble).
const MIN_SECTIONS = 3;

export class ResumeVerifier {
  verify(input: VerifyResumeInput): ResumeVerdict {
    const { renderedHtml, identity, requiredSections, claimedKeywords } = input;
    const html = renderedHtml ?? '';
    const checks: ResumeCheck[] = [];

    // 1a. Structural floor: the resume must have real section structure. This
    // is independent of the rendered markdown, so it genuinely fails on an
    // empty / header-less CV instead of passing vacuously.
    checks.push({
      name: 'section-count',
      pass: requiredSections.length >= MIN_SECTIONS,
      detail: `${requiredSections.length} sections (need >= ${MIN_SECTIONS})`,
    });

    // 1b. Each declared section survived into the output (render regression guard).
    for (const section of requiredSections) {
      const present = this.htmlIncludes(html, section);
      checks.push({
        name: `section:${section}`,
        pass: present,
        detail: present ? 'present' : `required section "${section}" is missing from the output`,
      });
    }

    // 2. Contact info matches profile.yml.
    const contact: Array<[string, string | null]> = [
      ['name', identity.name],
      ['email', identity.email],
      ['phone', identity.phone],
      ['linkedin', identity.linkedin],
      ['github', identity.github],
      ['portfolio', identity.portfolio],
      ['location', identity.location],
    ];
    for (const [field, value] of contact) {
      if (value === null || value === '') continue; // optional / absent (e.g. null portfolio)
      const present = this.htmlIncludes(html, value);
      checks.push({
        name: `contact:${field}`,
        pass: present,
        detail: present ? 'matches profile.yml' : `profile ${field} "${value}" not found in output`,
      });
    }

    // 3. Claimed keywords actually appear (same matcher as the planner).
    for (const kw of claimedKeywords) {
      const present = containsTerm(html, kw);
      checks.push({
        name: `keyword:${kw}`,
        pass: present,
        detail: present ? 'appears in output' : `claimed keyword "${kw}" does not appear in the output`,
      });
    }

    // 4. No leaked template placeholder.
    const leaked = leakedPlaceholders(html);
    checks.push({
      name: 'no-placeholder',
      pass: leaked.length === 0,
      detail: leaked.length === 0 ? 'no unfilled placeholders' : `leaked placeholders: ${leaked.join(', ')}`,
    });

    // 5. Page budget (visible-text proxy).
    const max = input.budget?.maxVisibleChars ?? DEFAULT_MAX_VISIBLE_CHARS;
    const visible = this.visibleTextLength(html);
    checks.push({
      name: 'page-budget',
      pass: visible <= max,
      detail: visible <= max
        ? `${visible} visible chars within ${max}`
        : `${visible} visible chars exceeds budget ${max}`,
    });

    return { pass: checks.every((c) => c.pass), checks };
  }

  /** Case-insensitive substring presence (section titles / contact values). */
  private htmlIncludes(html: string, value: string): boolean {
    return html.toLowerCase().includes(value.toLowerCase());
  }

  /** Visible text length: strip style/script blocks and tags, collapse space. */
  private visibleTextLength(html: string): number {
    const noBlocks = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const text = noBlocks.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length;
  }
}
