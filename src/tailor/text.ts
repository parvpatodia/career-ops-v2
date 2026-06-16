/**
 * Shared whole-token text matching for the tailoring pipeline.
 *
 * WHY one module: the extractor decides a keyword is "in the JD", the planner
 * decides it is "already on the resume" / "attested in the corpus", and the
 * Verifier decides the claimed keyword "actually appears" in the output. If any
 * two of those used different matching semantics they would drift, and the
 * checker could pass an output the maker mis-built (the same class of bug as the
 * affirmative-vocabulary drift in the form Verifier, LESSONS 2026-06-15). They
 * all call these helpers, so the semantics are identical by construction.
 *
 * Whole-token, case-insensitive: "Go" must not match inside "Going", and "RAG"
 * must not match inside "storage". Lookarounds on \w give that boundary while
 * still letting symbol-bearing skills ("C++", "Node.js", "scikit-learn") match.
 */

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenRegex(term: string, flags: string): RegExp {
  return new RegExp(`(?<![\\w])${escapeRegex(term)}(?![\\w])`, flags);
}

/** True when `term` appears in `text` as a whole token, case-insensitively. */
export function containsTerm(text: string, term: string): boolean {
  if (!term) return false;
  return tokenRegex(term, 'i').test(text);
}

/** Count of whole-token, case-insensitive occurrences of `term` in `text`. */
export function countTerm(text: string, term: string): number {
  if (!term) return 0;
  return (text.match(tokenRegex(term, 'gi')) || []).length;
}

const PLACEHOLDER_RE = /\{\{\s*[\w.]+\s*\}\}/g;

/** The distinct unfilled {{placeholder}} tokens left in a rendered document. */
export function leakedPlaceholders(s: string): string[] {
  return [...new Set(s.match(PLACEHOLDER_RE) ?? [])];
}
