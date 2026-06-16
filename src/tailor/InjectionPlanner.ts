/**
 * Plans no-fabrication ATS keyword injection.
 *
 * THE non-fabrication rule (AGENTS.md invariant 1; global CLAUDE.md "tailor =
 * select + reframe REAL experience only"):
 *
 *   A JD keyword is injected ONLY when it is ATTESTED — it already appears
 *   somewhere in Parv's master CV corpus, i.e. he genuinely has it — AND it is
 *   missing from the target variant. A keyword attested nowhere is SKIPPED and
 *   surfaced, never forced onto the resume. Skipping is the abstain of tailoring.
 *
 * WHY inject into the SKILLS section, not narrative bullets: rewriting an
 * experience bullet to graft in a tool the bullet was not about ("...shipped
 * models to production, leveraging Kubernetes") invents a claim — that is the
 * fabrication the old ResumeBuilder.injectKeyword risked. Growing the skills
 * ENUMERATION with a skill Parv actually has changes no claim: every line of
 * his experience is byte-identical before and after. The skills list is the one
 * place a real-but-omitted skill can be surfaced honestly for ATS matching.
 *
 * Pure and deterministic: identical inputs yield an identical plan. The thin IO
 * (reading the CV files, writing the tailored markdown) lives in the caller.
 */

import { containsTerm } from './text.js';

export interface PlannedInjection {
  keyword: string;
  /** Index (into markdown.split('\n')) of the skills line being grown. */
  lineIndex: number;
  /** The host line before any injection (for transparency / review). */
  before: string;
  /** The host line after this and any earlier injections on the same line. */
  after: string;
  reason: string;
}

export interface SkippedKeyword {
  keyword: string;
  reason: string;
}

export interface InjectionPlan {
  injections: PlannedInjection[];
  skipped: SkippedKeyword[];
}

const DEFAULT_MAX_INJECTIONS = 3;
const SKILLS_HEADER = /^##\s+.*(skill|competenc)/i;
const NEXT_SECTION = /^##\s+/;

export class InjectionPlanner {
  /**
   * @param variantMarkdown   the target CV variant (the document being tailored)
   * @param attestationCorpus the master CV text: the truth of what Parv has
   * @param keywords          ranked JD keywords (canonical surface forms)
   */
  plan(
    variantMarkdown: string,
    attestationCorpus: string,
    keywords: string[],
    maxInjections = DEFAULT_MAX_INJECTIONS
  ): InjectionPlan {
    const injections: PlannedInjection[] = [];
    const skipped: SkippedKeyword[] = [];

    const lines = variantMarkdown.split('\n');
    const hostIdx = this.findSkillsHostLine(lines);

    // Dedupe the incoming keywords (case-insensitive) preserving rank order.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const kw of keywords) {
      const k = kw.toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); ordered.push(kw); }
    }

    let injected = 0;
    let hostLine = hostIdx >= 0 ? lines[hostIdx] : '';

    for (const kw of ordered) {
      if (containsTerm(variantMarkdown, kw)) {
        skipped.push({ keyword: kw, reason: 'Already present in this resume variant; ATS already matches it.' });
        continue;
      }
      if (!containsTerm(attestationCorpus, kw)) {
        skipped.push({
          keyword: kw,
          reason: 'Not attested anywhere in the master CV; injecting it would fabricate a skill.',
        });
        continue;
      }
      // Attested and missing: an honest candidate.
      if (hostIdx < 0) {
        skipped.push({
          keyword: kw,
          reason: 'No skills section in this variant to host the keyword; refusing to fabricate one.',
        });
        continue;
      }
      if (injected >= maxInjections) {
        skipped.push({ keyword: kw, reason: `Injection budget (${maxInjections}) reached.` });
        continue;
      }
      hostLine = `${hostLine}, ${kw}`;
      injections.push({
        keyword: kw,
        lineIndex: hostIdx,
        before: lines[hostIdx],
        after: hostLine,
        reason: 'Attested in the master CV but absent from this variant; surfaced in the skills list for ATS parity.',
      });
      injected += 1;
    }

    return { injections, skipped };
  }

  /** Apply a plan to the markdown. Pure: only the planned skills line changes. */
  apply(variantMarkdown: string, plan: InjectionPlan): string {
    if (plan.injections.length === 0) return variantMarkdown;
    const lines = variantMarkdown.split('\n');
    // All injections target the same host line; the last carries the cumulative
    // result. Group defensively in case that ever changes.
    const finalByLine = new Map<number, string>();
    for (const inj of plan.injections) finalByLine.set(inj.lineIndex, inj.after);
    for (const [idx, text] of finalByLine) lines[idx] = text;
    return lines.join('\n');
  }

  /**
   * The skills line to grow: the LAST non-empty content line of the first
   * skills/competencies section. WHY the last line: real resumes tend to end
   * the skills block with a general "tools / other" line, the least bad host for
   * a cross-cutting keyword. Returns -1 when there is no skills section.
   */
  private findSkillsHostLine(lines: string[]): number {
    let inSection = false;
    let host = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (SKILLS_HEADER.test(line)) { inSection = true; continue; }
      if (inSection && NEXT_SECTION.test(line)) break; // left the skills section
      if (inSection && line.trim() !== '') host = i;
    }
    return host;
  }
}
