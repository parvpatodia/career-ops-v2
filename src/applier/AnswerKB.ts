/**
 * File-backed answer knowledge base: Parv's own answers, written once in
 * config/answers.yml, matched by normalized substring, reused forever.
 *
 * WHY this is the accuracy mechanism: every entry is human-authored, so
 * it carries humanApproved=true, the only credential that opens the
 * legal/EEO gate in IntentPayloadBuilder. Coverage grows as flagged
 * questions get answers added here; precision stays with the Verifier.
 *
 * Matching: first entry whose ANY pattern is a substring of the
 * normalized question wins. Order entries most-specific-first.
 */

import fs from 'fs';
import yaml from 'js-yaml';
import type { Answer, AnswerContext } from './AnswerGenerator.js';
import type { AnswerSource } from './IntentPayload.js';

export interface KbEntry {
  match: string[];
  value: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class AnswerKB implements AnswerSource {
  private readonly entries: KbEntry[];

  constructor(filePath = 'config/answers.yml') {
    this.entries = AnswerKB.load(filePath);
  }

  generate(question: string, _ctx: AnswerContext): Answer | null {
    const q = norm(question);
    const entry = this.entries.find((e) => e.match.some((p) => q.includes(norm(p))));
    if (!entry) return null;
    return { value: entry.value, confidence: 'high', needsReview: false, humanApproved: true };
  }

  size(): number {
    return this.entries.length;
  }

  private static load(filePath: string): KbEntry[] {
    if (!fs.existsSync(filePath)) return [];
    const raw = yaml.load(fs.readFileSync(filePath, 'utf8')) as { answers?: unknown[] } | null;
    const list = raw?.answers ?? [];
    const entries: KbEntry[] = [];

    for (const [i, item] of list.entries()) {
      const e = item as { match?: unknown; value?: unknown };
      const match = typeof e.match === 'string' ? [e.match] : e.match;
      if (!Array.isArray(match) || match.length === 0 || !match.every((m) => typeof m === 'string' && m.trim())) {
        throw new Error(`answers.yml entry ${i}: "match" must be a non-empty string or string array`);
      }
      if (typeof e.value !== 'string' || e.value.trim() === '') {
        // WHY hard fail: a blank KB value would silently blank a form
        // field with full human-approved confidence.
        throw new Error(`answers.yml entry ${i} (${match[0]}): "value" must be a non-empty string`);
      }
      entries.push({ match: match as string[], value: e.value });
    }
    return entries;
  }
}

/** Asks each source in order; first answer wins. KB first, generator second. */
export class CompositeAnswerSource implements AnswerSource {
  constructor(private readonly sources: AnswerSource[]) {}

  generate(question: string, ctx: AnswerContext): Answer | null {
    for (const source of this.sources) {
      const answer = source.generate(question, ctx);
      if (answer) return answer;
    }
    return null;
  }
}
