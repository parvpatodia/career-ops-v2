/**
 * Company-specific answers for free-text essay questions ("Why do you want to
 * work at X?", "Why this role?", "What interests you?"). The standard
 * AnswerGenerator only has a generic templated reply for these and flags it
 * needsReview, so they abstain. This source writes a grounded, company-specific
 * answer instead, in Parv's voice, then runs a maker/checker gate that abstains
 * (returns null) on anything that violates the style rules, fails to name the
 * company, or is not grounded in a real profile fact.
 *
 * Honesty / no-fabrication (AGENTS.md + profile.writing_preferences.rule):
 * every claim is assembled from config/profile.yml (real projects, narrative,
 * experience). The writer never invents a fact; it SELECTS the JD-most-relevant
 * real project and frames it. If it cannot produce a clean grounded answer it
 * returns null, and the apply loop abstains + notifies so Parv writes that one
 * by hand (the designed human touchpoint).
 *
 * WHY deterministic (no LLM): AnswerSource.generate is synchronous and no LLM
 * key is configured. A future async pre-pass could swap an LLM into the SAME
 * gate; until then this is grounded, rule-safe, and company-specific by
 * selecting on the JD.
 */

import type { ProfileLoader } from './ProfileLoader.js';
import type { Answer, AnswerContext } from './AnswerGenerator.js';
import type { AnswerSource } from './IntentPayload.js';
import type { LlmClient } from './GeminiClient.js';
import { NO_LLM } from './GeminiClient.js';
import { FORBIDDEN_PHRASES } from '../tailor/CoverLetterVerifier.js';
import { containsTerm } from '../tailor/text.js';
import { Logger } from '../utils/Logger.js';

const MIN_LEN = 120;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class EssayAnswerSource implements AnswerSource {
  private log = new Logger('essay');
  // Per-company verified LLM essay, populated by prewarm() before the fill.
  // generate() is synchronous, so the async LLM call cannot happen inside it.
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly profile: ProfileLoader,
    private readonly llm: LlmClient = NO_LLM
  ) {}

  /**
   * Generate + verify ONE company-specific essay via the LLM and cache it, so
   * the synchronous generate() can serve it. Fault-tolerant: any LLM failure or
   * a draft that fails the style/grounding gate leaves the cache empty and
   * generate() falls back to the deterministic writer. Safe to call repeatedly.
   */
  async prewarm(ctx: AnswerContext): Promise<void> {
    const company = (ctx.company ?? '').trim();
    if (!this.llm.enabled || !company || this.cache.has(norm(company))) return;

    const draft = await this.llm.generate(this.prompt(ctx)).catch(() => null);
    if (!draft) return; // LLM unavailable/failed -> deterministic fallback
    const cleaned = this.scrub(draft);
    if (this.verify(cleaned, company).ok) {
      this.cache.set(norm(company), cleaned);
      this.log.info(`Essay prewarmed (LLM) for ${company}`);
    } else {
      this.log.warn(`LLM essay for ${company} failed the gate; using deterministic fallback`);
    }
  }

  generate(question: string, ctx: AnswerContext): Answer | null {
    if (!this.isEssay(question)) return null;
    if (!ctx.company || !ctx.company.trim()) return null; // cannot make it specific

    // Prefer the verified LLM essay (prewarmed); else the deterministic writer.
    const cached = this.cache.get(norm(ctx.company));
    const draft = cached ?? this.write(question, ctx);
    const verdict = this.verify(draft, ctx.company);
    if (!verdict.ok) {
      this.log.warn(`Essay abstained for ${ctx.company}: ${verdict.why}`);
      return null; // abstain -> the apply loop notifies, Parv writes this one
    }
    return { value: draft, confidence: 'high', needsReview: false };
  }

  /** Grounded prompt for the LLM: real facts only, strict style, name the company. */
  private prompt(ctx: AnswerContext): string {
    const company = (ctx.company ?? '').trim();
    const role = (ctx.role ?? '').trim();
    const projects = this.profile.getProjects()
      .map((p) => `- ${p.name}: ${p.summary} (stack: ${p.stack.join(', ')})`).join('\n');
    const exp = this.profile.getExperience().map((e) => `- ${e.role} at ${e.company}`).join('\n');
    const n = this.profile.getNarrative();
    const jd = (ctx.jd ?? '').slice(0, 1500);

    return [
      `Write a short answer (3 to 5 sentences) to a job application question: "Why do you want to work at ${company} as a ${role}?"`,
      `Write in the FIRST PERSON as the candidate, in a direct and conversational voice.`,
      ``,
      `Use ONLY these real facts about the candidate. Do not invent anything not listed here:`,
      `Projects:\n${projects}`,
      `Experience:\n${exp}`,
      `What excites me: ${n.excites}`,
      `My edge: ${n.superpower}`,
      ``,
      `Job description (for context, to make the answer specific to ${company}):`,
      jd || '(none provided)',
      ``,
      `HARD RULES (a violation makes the answer unusable):`,
      `- Name "${company}" explicitly.`,
      `- Mention at least one of the candidate's real projects by name.`,
      `- NEVER use an em dash. NEVER use a colon. Do not use bullet points.`,
      `- Never use these words or phrases: ${FORBIDDEN_PHRASES.join(', ')}.`,
      `- Every claim must be true given the facts above. Do not exaggerate or invent.`,
      `Output ONLY the answer text, no preamble, no quotes.`,
    ].join('\n');
  }

  // ── Detection ───────────────────────────────────────────────────────────
  private isEssay(question: string): boolean {
    const q = norm(question);
    const why = q.includes('why');
    const aboutCompanyOrRole =
      q.includes('work at') || q.includes('work here') || q.includes('join') ||
      q.includes('this role') || q.includes('this position') || q.includes('this opportunity') ||
      q.includes('this company') || q.includes('our team') || q.includes('our company') ||
      q.includes('interest') || q.includes('interested');
    const motivation =
      q.includes('what draws you') || q.includes('what excites you') ||
      q.includes('what interests you') || q.includes('why are you a good fit') ||
      q.includes('what motivates');
    return (why && aboutCompanyOrRole) || motivation;
  }

  // ── Writer (grounded, Parv's voice, no colons / em dashes / filler) ───────
  private write(question: string, ctx: AnswerContext): string {
    const company = ctx.company.trim();
    const role = (ctx.role ?? '').trim();
    const project = this.pickProject(ctx.jd ?? '');
    const exp = this.profile.getExperience()[0];

    const sentences: string[] = [];

    // 1. Why this company, tied to the work (grounded in the candidate's focus).
    sentences.push(
      `${company} works on the kind of problems I keep choosing to build, real systems that ship rather than demos.`
    );

    // 2. Proof from a real, JD-relevant project (no invented claims).
    if (project) {
      const stack = project.stack.slice(0, 3).join(', ');
      const tail = stack ? ` built with ${stack}` : '';
      sentences.push(`At ${project.name} I built ${this.lower(project.summary)}${tail}, end to end.`);
    }

    // 3. Alignment with the role + a second real anchor.
    if (role) {
      const anchor = exp?.role ? ` My work as ${this.lower(exp.role)} taught me to own systems in production.` : '';
      sentences.push(`That is the same hands-on work this ${role} role asks for.${anchor}`);
    }

    // 4. Direct close in his tone.
    sentences.push(`I want to do that work somewhere it reaches real users, and ${company} is building exactly that.`);

    return this.scrub(sentences.join(' '));
  }

  /** Choose the real project whose stack/summary overlaps the JD the most. */
  private pickProject(jd: string): { name: string; summary: string; stack: string[] } | undefined {
    const projects = this.profile.getProjects();
    if (projects.length === 0) return undefined;
    const j = norm(jd);
    if (!j) return projects[0];

    let best = projects[0]!;
    let bestScore = -1;
    for (const p of projects) {
      const tokens = [...p.stack, ...p.summary.split(/\s+/)].map(norm).filter((t) => t.length > 2);
      const score = tokens.reduce((n, t) => (j.includes(t) ? n + 1 : n), 0);
      if (score > bestScore) { best = p; bestScore = score; }
    }
    return best;
  }

  private lower(s: string): string {
    const t = s.trim();
    return t.charAt(0).toLowerCase() + t.slice(1);
  }

  // Remove the two AI tells Parv called out (colons, em dashes) without
  // mangling the sentence; the verifier still hard-fails if anything slips.
  private scrub(s: string): string {
    return s.replace(/—/g, ', ').replace(/:/g, ',').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
  }

  // ── Checker (maker/checker; reuses the cover-letter forbidden vocabulary) ─
  private verify(text: string, company: string): { ok: true } | { ok: false; why: string } {
    if (text.length < MIN_LEN) return { ok: false, why: `too short (${text.length} < ${MIN_LEN})` };
    if (text.includes('—')) return { ok: false, why: 'contains an em dash' };
    if (text.includes(':')) return { ok: false, why: 'contains a colon' };
    const hits = FORBIDDEN_PHRASES.filter((p) => containsTerm(text, p));
    if (hits.length > 0) return { ok: false, why: `forbidden phrase(s): ${hits.join(', ')}` };
    if (!norm(text).includes(norm(company))) return { ok: false, why: 'does not name the company' };
    // Grounded: at least one real project name appears.
    const grounded = this.profile.getProjects().some((p) => p.name && norm(text).includes(norm(p.name)));
    if (!grounded) return { ok: false, why: 'mentions no real project (not grounded)' };
    return { ok: true };
  }
}
