/**
 * Generates tailored cover letters from the template (the MAKER). The quality
 * gate is now VERIFY-OR-ABSTAIN: the letter is checked by the independent
 * CoverLetterVerifier and, on any failure (forbidden phrase, em dash, missing
 * company/role, leaked placeholder, ungrounded), build() THROWS and writes
 * nothing. The pre-M6 builder only log.warn'd on forbidden phrases and shipped
 * the letter anyway — a silent-fallback that this removes.
 *
 * WHY generated fresh per application (vs a resume variant): a generic cover
 * letter has near-zero value and recruiters reject LLM boilerplate on sight
 * (LESSONS 2026-06-10); a specific, grounded one is the only kind worth sending.
 *
 * Paths are injectable (LESSONS 2026-06-12: side-effecting classes take paths so
 * tests use fixtures and temp dirs, never real PII).
 */

import fs from 'fs';
import path from 'path';
import type { EvaluationResult } from '../types.js';
import { Logger } from '../utils/Logger.js';
import { CoverLetterVerifier, FORBIDDEN_PHRASES, type CoverLetterVerdict } from './CoverLetterVerifier.js';
import { containsTerm } from './text.js';

export interface CoverLetterData {
  company: string;
  role: string;
  companySpecificAngle: string;
  strongestProject: string;
  experienceAlignment: string;
  closing: string;
}

export interface CoverLetterBuildResult {
  letter: string;
  verdict: CoverLetterVerdict;
  outputPath: string;
}

const DEFAULT_TEMPLATE = 'cv/cover_letter_template.md';
const DEFAULT_OUTPUT_DIR = 'output/cover_letters';
const SCORE_THRESHOLD = 60;

export class CoverLetterBuilder {
  private log = new Logger('CoverLetterBuilder');
  private verifier = new CoverLetterVerifier();
  private readonly templatePath: string;
  private readonly outputDir: string;

  constructor(opts?: { templatePath?: string; outputDir?: string }) {
    this.templatePath = opts?.templatePath ?? DEFAULT_TEMPLATE;
    this.outputDir = opts?.outputDir ?? DEFAULT_OUTPUT_DIR;
  }

  /**
   * Build, verify, and (only if it passes) write a cover letter. Throws on a
   * below-threshold score or a verification failure — the caller treats a throw
   * as an abstain (no letter shipped).
   */
  build(
    jobId: string,
    data: CoverLetterData,
    evaluation: Pick<EvaluationResult, 'score'>,
    opts?: { groundingFacts?: string[] }
  ): CoverLetterBuildResult {
    if (evaluation.score < SCORE_THRESHOLD) {
      throw new Error(`Score ${evaluation.score} is below cover letter threshold (${SCORE_THRESHOLD}). Skipping.`);
    }

    const template = fs.readFileSync(this.templatePath, 'utf8');
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    let letter = template
      .replace(/\{\{DATE\}\}/g, date)
      .replace(/\{\{COMPANY_NAME\}\}/g, data.company)
      .replace(/\{\{ROLE_TITLE\}\}/g, data.role)
      .replace(/\{\{PARA_1_WHY_COMPANY\}\}/g, data.companySpecificAngle)
      .replace(/\{\{PARA_2_STRONGEST_PROJECT\}\}/g, data.strongestProject)
      .replace(/\{\{PARA_3_EXPERIENCE_ALIGNMENT\}\}/g, data.experienceAlignment)
      .replace(/\{\{PARA_4_CLOSE\}\}/g, data.closing);

    // Strip the template instructions block (everything from the Rules header).
    const rulesIdx = letter.indexOf('## Rules for this template');
    if (rulesIdx > 0) letter = letter.slice(0, rulesIdx).trim();

    const verdict = this.verifier.verify({
      letter,
      company: data.company,
      role: data.role,
      groundingFacts: opts?.groundingFacts,
    });

    if (!verdict.pass) {
      const failed = verdict.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`);
      throw new Error(`Cover letter abstained for ${jobId}: ${failed.join('; ')}`);
    }

    const outputPath = this.getOutputPath(jobId);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, letter);
    this.log.info(`Generated cover letter: ${outputPath}`);

    return { letter, verdict, outputPath };
  }

  /** Back-compat helper: forbidden phrases present, matched whole-word. */
  checkForbiddenPhrases(text: string): string[] {
    return FORBIDDEN_PHRASES.filter((phrase) => containsTerm(text, phrase));
  }

  getOutputPath(jobId: string): string {
    return path.join(this.outputDir, `${jobId}.md`);
  }
}
