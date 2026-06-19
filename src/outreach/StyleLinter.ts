/**
 * Deterministic enforcement of Parv's writing rules on any text that will reach
 * a stranger. The drafter (Claude) is told to avoid these, but a model policing
 * its own output is the maker judging its own work (AGENTS.md invariant 2); this
 * pure linter is the independent checker. A draft that does not pass never
 * auto-sends.
 *
 * The banned vocabulary lives HERE, the single source for the code. It mirrors
 * the global CLAUDE.md list: em/en dashes, AI-favored filler, and forced
 * enthusiasm.
 */

export type ViolationKind = 'dash' | 'banned-term';

export interface Violation {
  kind: ViolationKind;
  /** The canonical label of the rule that fired (e.g. "leverage", "em-dash"). */
  label: string;
  /** The exact matched text. */
  match: string;
  /** Character offset into the linted text. */
  index: number;
}

export interface LintResult {
  ok: boolean;
  violations: Violation[];
}

// Em dash, en dash, horizontal bar, and the "--" ASCII substitute.
const DASH_RE = /[–—―]|--/g;
const DASH_LABELS: Record<string, string> = {
  '—': 'em-dash',
  '–': 'en-dash',
  '―': 'horizontal-bar',
  '--': 'double-hyphen',
};

// WHY explicit per-term regexes instead of one stem+suffix rule: "key" must
// not match "keyboard" and "robust" must not match a name, yet "leveraging"
// and "utilized" must still be caught. Each entry encodes only the variants
// that are genuinely the same AI-tell.
const BANNED: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'leverage', re: /\bleverag(?:e|es|ed|ing)\b/gi },
  { label: 'utilize', re: /\butiliz(?:e|es|ed|ing|ation)\b/gi },
  { label: 'facilitate', re: /\bfacilitat(?:e|es|ed|ing)\b/gi },
  { label: 'implement', re: /\bimplement(?:s|ed|ing|ation|ations)?\b/gi },
  { label: 'delve', re: /\bdelv(?:e|es|ed|ing)\b/gi },
  { label: 'straightforward', re: /\bstraightforward\b/gi },
  { label: 'crucial', re: /\bcrucial(?:ly)?\b/gi },
  { label: 'key', re: /\bkey\b/gi },
  { label: 'robust', re: /\brobust(?:ness)?\b/gi },
  { label: 'synergy', re: /\bsynerg(?:y|ies|istic)\b/gi },
  { label: 'innovative', re: /\binnovat(?:ive|ion|ions)\b/gi },
  { label: 'groundbreaking', re: /\bgroundbreaking\b/gi },
  { label: 'cutting-edge', re: /\bcutting[- ]edge\b/gi },
  { label: 'transformative', re: /\btransformative\b/gi },
  { label: 'seamless', re: /\bseamless(?:ly)?\b/gi },
  { label: 'scalable', re: /\bscalab(?:le|ility)\b/gi },
  { label: 'game-changer', re: /\bgame[- ]chang(?:er|ing)\b/gi },
  { label: 'importantly', re: /\bimportantly\b/gi },
  { label: 'notably', re: /\bnotably\b/gi },
  { label: "it's worth noting", re: /it['’]s worth noting/gi },
  { label: 'in conclusion', re: /\bin conclusion\b/gi },
  { label: 'to summarize', re: /\bto summarize\b/gi },
  { label: 'excited', re: /\bexcited\b/gi },
  { label: 'passionate', re: /\bpassionate\b/gi },
  { label: 'thrilled', re: /\bthrilled\b/gi },
  { label: 'happy to', re: /\bhappy to\b/gi },
  { label: 'glad to', re: /\bglad to\b/gi },
];

export class StyleLinter {
  /** Find every banned token in `text`. Pure: no state, safe to call concurrently. */
  lint(text: string): LintResult {
    const violations: Violation[] = [];

    for (const m of text.matchAll(DASH_RE)) {
      violations.push({
        kind: 'dash',
        label: DASH_LABELS[m[0]] ?? 'dash',
        match: m[0],
        index: m.index ?? 0,
      });
    }

    for (const { label, re } of BANNED) {
      for (const m of text.matchAll(re)) {
        violations.push({ kind: 'banned-term', label, match: m[0], index: m.index ?? 0 });
      }
    }

    violations.sort((a, b) => a.index - b.index);
    return { ok: violations.length === 0, violations };
  }
}
