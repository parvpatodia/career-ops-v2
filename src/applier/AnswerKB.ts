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
  private entries: KbEntry[];

  constructor(private readonly filePath = 'config/answers.yml') {
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

  /**
   * Re-read the YAML from disk into the cache. WHY: the constructor loads
   * entries once, so a long-lived AnswerKB (e.g. the learned-answers source
   * inside a CompositeAnswerSource the M4 batch loop reuses across resume
   * iterations) never sees an answer AnswerInbox.resolve just wrote, and
   * re-abstains on the same question forever (LESSONS.md 2026-06-16). Call this
   * after resolve, before re-running the job.
   */
  reload(): void {
    this.entries = AnswerKB.load(this.filePath);
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

  /**
   * Cascade reload to every source with file-backed state (e.g. the learned
   * AnswerKB). In-memory sources (the generator, a stub identity) have no
   * reload() and are skipped. This is the single call the M4 resume loop makes
   * after AnswerInbox.resolve so the next run sees the new answer.
   */
  reload(): void {
    for (const source of this.sources) source.reload?.();
  }
}
