/**
 * Extracts ranked, deduped ATS keywords from a FULL job description.
 *
 * WHY a dedicated extractor (vs JobParser.extractKeywords): JobParser caps at
 * 15 known skills and ignores frequency, section, and JD-specific acronyms.
 * Tailoring needs the JD's REAL emphasis: a required-section term matters more
 * than a "nice to have", and a term repeated five times matters more than one
 * mentioned once. This is the pure, deterministic core that feeds the
 * InjectionPlanner.
 *
 * Abstain-on-stub (LESSONS 2026-06-10): a 2-line stub JD jammed the v1 queue
 * because the quality gate ran on too little text. Here, a JD below the size
 * floor returns abstained=true with NO keywords, never a guessed list.
 */

import { SKILL_PATTERNS } from '../evaluator/skills.js';
import { containsTerm, countTerm } from './text.js';

export interface RankedKeyword {
  /** Canonical surface form used for ATS matching (e.g. "PyTorch"). */
  term: string;
  /** Case-insensitive occurrence count across the whole JD. */
  hits: number;
  /** True when the term appears inside a required/qualifications region. */
  required: boolean;
  /** Ranking score: higher = more important to surface on the resume. */
  score: number;
}

export interface KeywordExtraction {
  abstained: boolean;
  reason?: string;
  keywords: RankedKeyword[];
}

// A real JD runs to hundreds or thousands of characters. Below this, the text
// is a stub (a title + "apply now") that cannot be trusted for extraction.
const MIN_JD_CHARS = 200;

// Cap the surfaced list: beyond ~25 the tail is noise for tailoring.
const MAX_KEYWORDS = 25;

const REQUIRED_HEADERS = ['required', 'must have', 'qualifications', 'requirements', "what you'll need", 'what you need'];
const PREFERRED_HEADERS = ['preferred', 'nice to have', 'nice-to-have', 'bonus', 'what we offer', 'benefits', 'perks'];

// All-caps tokens that are grammar/HR/legal/business noise, not skills. Kept
// conservative so real acronym skills (ML, AI, NLP, RAG, ETL, AWS, GPU, SDK,
// SQL, API, LLM, CI, CD, UI, UX...) are never lost — only tokens that are
// unambiguously NOT a resume skill are listed.
const ACRONYM_STOPWORDS: ReadonlySet<string> = new Set([
  // grammar / filler / time / HR / legal
  'AND', 'OR', 'THE', 'FOR', 'WITH', 'YOU', 'WE', 'OUR', 'US', 'TO', 'OF', 'IN',
  'ON', 'AT', 'IS', 'ARE', 'BE', 'AS', 'IF', 'IT', 'BY', 'AN', 'A', 'ALL', 'NEW',
  'NOW', 'EEO', 'EOE', 'PTO', 'FLSA', 'ADA', 'HR', 'HRIS', 'CEO', 'CTO', 'OK', 'FAQ',
  'USA', 'PST', 'EST', 'PDT', 'EDT', 'AM', 'PM', 'Q1', 'Q2', 'Q3', 'Q4', 'FTE', 'NDA',
  // business / finance / go-to-market metrics + contract docs (never a skill)
  'B2B', 'B2C', 'ROI', 'KPI', 'OKR', 'SLA', 'RFP', 'RFQ', 'SOW', 'MSA', 'KYC',
  'ARR', 'MRR', 'CAC', 'LTV', 'GTM', 'SMB', 'YOY', 'QOQ',
]);

interface Candidate {
  /** lowercased key for dedup/merge */
  key: string;
  /** canonical display form */
  term: string;
  known: boolean;
}

export class KeywordExtractor {
  extract(jd: string): KeywordExtraction {
    const text = (jd ?? '').trim();
    if (text.length < MIN_JD_CHARS) {
      return {
        abstained: true,
        reason: `JD is ${text.length} chars, below the ${MIN_JD_CHARS}-char floor; refusing to extract from a stub.`,
        keywords: [],
      };
    }

    const requiredRegion = this.requiredRegion(text).toLowerCase();
    const candidates = this.collectCandidates(text);

    const ranked: RankedKeyword[] = [];
    for (const c of candidates.values()) {
      const hits = this.countHits(text, c.term);
      if (hits === 0) continue;
      const required = this.regionHas(requiredRegion, c.term);
      const score = hits + (required ? 2 : 0) + (c.known ? 1 : 0);
      ranked.push({ term: c.term, hits, required, score });
    }

    ranked.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
    return { abstained: false, keywords: ranked.slice(0, MAX_KEYWORDS) };
  }

  /**
   * The slice of the JD between the first required-style header and the first
   * preferred-style header that follows it. WHY: a term inside the required
   * region should outrank an equally-frequent preferred-only term.
   */
  private requiredRegion(text: string): string {
    const lc = text.toLowerCase();
    const reqIdx = this.firstIndexOf(lc, REQUIRED_HEADERS);
    if (reqIdx < 0) return text; // no explicit split: treat the whole JD as required-weight
    const prefIdx = this.firstIndexOf(lc, PREFERRED_HEADERS, reqIdx + 1);
    return prefIdx > reqIdx ? text.slice(reqIdx, prefIdx) : text.slice(reqIdx);
  }

  private firstIndexOf(haystack: string, needles: readonly string[], from = 0): number {
    let best = -1;
    for (const n of needles) {
      const i = haystack.indexOf(n, from);
      if (i >= 0 && (best === -1 || i < best)) best = i;
    }
    return best;
  }

  private collectCandidates(text: string): Map<string, Candidate> {
    const out = new Map<string, Candidate>();
    const add = (term: string, known: boolean): void => {
      const key = term.toLowerCase();
      const existing = out.get(key);
      // A known-skill canonical form always wins over an acronym-scrape form.
      if (!existing || (known && !existing.known)) out.set(key, { key, term, known });
    };

    // 1. Known skills (canonical casing wins).
    for (const skill of SKILL_PATTERNS) {
      if (this.countHits(text, skill) > 0) add(skill, true);
    }

    // 2. Acronyms / capitalized tech tokens, preserving original case.
    const acronymRe = /\b[A-Za-z][A-Za-z0-9/+.#-]{1,9}\b/g;
    for (const m of text.matchAll(acronymRe)) {
      const tok = m[0];
      // Acronym-like = all letters uppercase (allowing digits/symbols), >= 2 chars.
      const letters = tok.replace(/[^A-Za-z]/g, '');
      if (letters.length < 2) continue;
      if (letters !== letters.toUpperCase()) continue; // skip Title-case words
      if (ACRONYM_STOPWORDS.has(tok.toUpperCase())) continue;
      if (/^\d+$/.test(tok)) continue;
      add(tok, false);
    }

    return out;
  }

  /** Case-insensitive whole-term occurrence count. */
  private countHits(text: string, term: string): number {
    return countTerm(text, term);
  }

  private regionHas(regionLc: string, term: string): boolean {
    return containsTerm(regionLc, term);
  }
}
