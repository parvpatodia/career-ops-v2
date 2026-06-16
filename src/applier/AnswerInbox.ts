/**
 * The self-improving coverage loop (AGENTS.md mission: human intervention
 * trends to zero as the AnswerKB grows). When the adapter abstains on a
 * genuinely-unknown question, it is flagged here; once Parv answers it, the
 * answer is written to a machine-managed AnswerKB file so the same question is
 * never unknown again.
 *
 * WHY a separate `answers.learned.yml` instead of rewriting answers.yml:
 * config/answers.yml is hand-authored with comments and intent. A program that
 * re-dumps YAML destroys those comments. Learned answers accumulate in their
 * own file, which CompositeAnswerSource reads alongside the hand-authored one.
 *
 * WHY learned answers carry humanApproved=true: they ARE human-authored (Parv
 * typed them in response to the notification), so they may open the legal/EEO
 * gate exactly like answers.yml entries (invariant 7). resolve() is the only
 * way an entry gets here, and it requires a human-supplied value.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { AnswerKB } from './AnswerKB.js';
import type { AnswerContext } from './AnswerGenerator.js';

export interface PendingQuestion {
  /** Normalized question label: the dedup key and the future KB match pattern. */
  match: string;
  label: string;
  why: string;
  company: string;
  role: string;
  askedAt: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

const DEFAULT_PENDING = 'data/pending-answers.json';
const DEFAULT_LEARNED = 'config/answers.learned.yml';

export class AnswerInbox {
  constructor(
    private readonly pendingPath: string = DEFAULT_PENDING,
    private readonly learnedPath: string = DEFAULT_LEARNED
  ) {}

  /**
   * Record an unknown question for human follow-up. Deduped by normalized
   * label, so the same question across many jobs is one inbox entry. Returns
   * the entry, or null if it was already pending or already learned.
   */
  flag(question: string, ctx: AnswerContext, why: string): PendingQuestion | null {
    const match = norm(question);
    if (!match) return null;
    if (this.isLearned(match)) return null;

    const pending = this.readPending();
    if (pending.some((p) => p.match === match)) return null;

    const entry: PendingQuestion = {
      match,
      label: question.trim(),
      why,
      company: ctx.company,
      role: ctx.role,
      askedAt: new Date().toISOString(),
    };
    pending.push(entry);
    this.writePending(pending);
    return entry;
  }

  listPending(): PendingQuestion[] {
    return this.readPending();
  }

  /**
   * Teach the system Parv's answer: append a human-approved entry to the
   * learned AnswerKB file and drop it from the inbox. After this, a fresh
   * AnswerKB over the learned file answers the question forever.
   */
  resolve(match: string, value: string): void {
    const key = norm(match);
    if (!key) throw new Error('AnswerInbox.resolve: empty match');
    if (!value.trim()) {
      // WHY hard fail: a blank value would blank a form field with full
      // human-approved confidence (same guard AnswerKB.load enforces).
      throw new Error('AnswerInbox.resolve: value must be non-empty');
    }

    const doc = this.readLearned();
    doc.answers.push({ match: [key], value });
    fs.mkdirSync(path.dirname(this.learnedPath), { recursive: true });
    fs.writeFileSync(this.learnedPath, yaml.dump(doc));

    this.writePending(this.readPending().filter((p) => p.match !== key));
  }

  /** AnswerSource over the learned file, for CompositeAnswerSource to include. */
  learnedSource(): AnswerKB {
    return new AnswerKB(this.learnedPath);
  }

  private isLearned(match: string): boolean {
    return this.readLearned().answers.some((a) =>
      (Array.isArray(a.match) ? a.match : [a.match]).some((m) => norm(String(m)) === match)
    );
  }

  private readPending(): PendingQuestion[] {
    if (!fs.existsSync(this.pendingPath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.pendingPath, 'utf8')) as { pending?: PendingQuestion[] };
      return Array.isArray(raw.pending) ? raw.pending : [];
    } catch {
      // A corrupt inbox must not crash the autopilot; treat as empty.
      return [];
    }
  }

  private writePending(pending: PendingQuestion[]): void {
    fs.mkdirSync(path.dirname(this.pendingPath), { recursive: true });
    fs.writeFileSync(this.pendingPath, JSON.stringify({ pending }, null, 2) + '\n');
  }

  private readLearned(): { answers: Array<{ match: string | string[]; value: string }> } {
    if (!fs.existsSync(this.learnedPath)) return { answers: [] };
    const raw = yaml.load(fs.readFileSync(this.learnedPath, 'utf8')) as
      | { answers?: Array<{ match: string | string[]; value: string }> }
      | null;
    return { answers: raw?.answers ?? [] };
  }
}
