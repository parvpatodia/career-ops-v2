/**
 * The independent CHECKER for a cover letter (maker/checker split). The
 * CoverLetterBuilder fills the template (maker); this gate decides whether the
 * draft may ship. On any failure the builder ABSTAINS — a generic or
 * rule-violating letter is never written (verify-or-abstain).
 *
 * Six properties:
 *   - no forbidden AI-filler phrase (the extended writing-style gate)
 *   - no em dash (global style rule)
 *   - names the company
 *   - names the role
 *   - no leaked template placeholder (every supplied specific is present)
 *   - grounded: at least one real profile fact appears (when facts are supplied)
 *
 * Forbidden phrases are matched WHOLE-WORD via the shared matcher, so "key" no
 * longer false-matches "monkey" the way the old substring gate did, while the
 * common inflections are listed explicitly so coverage is not weakened.
 */

import { containsTerm, leakedPlaceholders } from './text.js';

// Extends the original CoverLetterBuilder gate (passionate about / excited to /
// i believe / leverage / utilize / endeavor / holistic / synergy / innovative
// solutions / drive impact / i am writing to) with the global CLAUDE.md
// forbidden vocabulary and the common verb inflections. NEVER weaken this list.
export const FORBIDDEN_PHRASES: readonly string[] = [
  // originals (kept)
  'passionate about', 'passionate', 'excited to', 'excited', 'i believe',
  'leverage', 'leverages', 'leveraging', 'utilize', 'utilizes', 'utilizing',
  'endeavor', 'holistic', 'synergy', 'innovative solutions', 'drive impact',
  'i am writing to',
  // global CLAUDE.md forbidden filler
  'straightforward', 'delve', 'crucial', 'key', 'robust', 'game-changer',
  'innovative', 'groundbreaking', 'cutting-edge', 'transformative', 'seamless',
  'scalable', 'facilitate', 'facilitates', 'facilitating', "it's worth noting",
  'importantly', 'notably', 'in conclusion', 'to summarize', 'thrilled',
  'happy to', 'glad to',
];

export interface CoverLetterCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface CoverLetterVerdict {
  pass: boolean;
  checks: CoverLetterCheck[];
}

export interface VerifyLetterInput {
  letter: string;
  company: string;
  role: string;
  /** Real profile anchors (name, university, project). Grounding requires >=1. */
  groundingFacts?: string[];
}

export class CoverLetterVerifier {
  verify(input: VerifyLetterInput): CoverLetterVerdict {
    const { letter, company, role } = input;
    const text = letter ?? '';
    // Whitespace-normalized lowercase: a company/role/fact named across a line
    // break ("Robotics Software\nIntern") still counts as named.
    const lc = text.toLowerCase().replace(/\s+/g, ' ');
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const checks: CoverLetterCheck[] = [];

    // 1. Forbidden phrases (whole-word).
    const hits = FORBIDDEN_PHRASES.filter((p) => containsTerm(text, p));
    checks.push({
      name: 'forbidden-phrases',
      pass: hits.length === 0,
      detail: hits.length === 0 ? 'clean' : `forbidden: ${hits.join(', ')}`,
    });

    // 2. No em dash.
    const emDash = text.includes('—');
    checks.push({
      name: 'no-em-dash',
      pass: !emDash,
      detail: emDash ? 'contains an em dash' : 'no em dash',
    });

    // 3. Names the company.
    const hasCompany = !!company && lc.includes(norm(company));
    checks.push({
      name: 'names-company',
      pass: hasCompany,
      detail: hasCompany ? `names "${company}"` : `does not name the company "${company}"`,
    });

    // 4. Names the role.
    const hasRole = !!role && lc.includes(norm(role));
    checks.push({
      name: 'names-role',
      pass: hasRole,
      detail: hasRole ? `names "${role}"` : `does not name the role "${role}"`,
    });

    // 5. No leaked placeholder.
    const leaked = leakedPlaceholders(text);
    checks.push({
      name: 'no-placeholder',
      pass: leaked.length === 0,
      detail: leaked.length === 0 ? 'no unfilled placeholders' : `leaked: ${leaked.join(', ')}`,
    });

    // 6. Grounded in a real profile fact (only when facts are supplied).
    const facts = input.groundingFacts ?? [];
    if (facts.length > 0) {
      const grounded = facts.some((f) => f && lc.includes(norm(f)));
      checks.push({
        name: 'grounded',
        pass: grounded,
        detail: grounded ? 'mentions a real profile fact' : 'mentions no supplied profile fact (generic draft)',
      });
    }

    return { pass: checks.every((c) => c.pass), checks };
  }
}
