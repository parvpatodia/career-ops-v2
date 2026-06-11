/**
 * Generates tailored cover letters from the template.
 * WHY: Cover letters are generated fresh per application (unlike resumes
 * where we select a variant) because generic cover letters have near-zero
 * impact, while specific ones improve interview conversion measurably.
 */

import fs from 'fs';
import path from 'path';
import type { EvaluationResult, ResumeVariant } from '../types.js';
import { Logger } from '../utils/Logger.js';

const TEMPLATE_PATH = 'cv/cover_letter_template.md';

// Forbidden phrases per writing_preferences in profile.yml
const FORBIDDEN_PHRASES = [
  'em dash', 'passionate about', 'excited to', "i believe", 'leverage',
  'utilize', 'endeavor', 'holistic', 'synergy', 'innovative solutions',
  'drive impact', 'i am writing to',
];

interface CoverLetterData {
  company: string;
  role: string;
  companySpecificAngle: string;
  strongestProject: string;
  experienceAlignment: string;
  closing: string;
}

export class CoverLetterBuilder {
  private log = new Logger('CoverLetterBuilder');

  /**
   * Build a cover letter. The companyContext must be supplied by Claude Code
   * (via the tailor skill) since this class can't do web research.
   * WHY: Separating data gathering (Claude Code) from formatting (this class)
   * keeps the class testable and the prompts focused.
   */
  build(
    jobId: string,
    data: CoverLetterData,
    evaluation: EvaluationResult
  ): string {
    if (evaluation.score < 60) {
      throw new Error(`Score ${evaluation.score} is below cover letter threshold (60). Skipping.`);
    }

    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let letter = template
      .replace('{{DATE}}', date)
      .replace('{{COMPANY_NAME}}', data.company)
      .replace('{{ROLE_TITLE}}', data.role)
      .replace('{{PARA_1_WHY_COMPANY}}', data.companySpecificAngle)
      .replace('{{PARA_2_STRONGEST_PROJECT}}', data.strongestProject)
      .replace('{{PARA_3_EXPERIENCE_ALIGNMENT}}', data.experienceAlignment)
      .replace('{{PARA_4_CLOSE}}', data.closing);

    // Strip template instructions block
    const rulesIdx = letter.indexOf('## Rules for this template');
    if (rulesIdx > 0) letter = letter.slice(0, rulesIdx).trim();

    // Validate forbidden phrases
    const violations = this.checkForbiddenPhrases(letter);
    if (violations.length > 0) {
      this.log.warn('Cover letter contains forbidden phrases', violations);
    }

    // Save to output
    const outputPath = path.join('output', 'cover_letters', `${jobId}.md`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, letter);

    this.log.info(`Generated cover letter: ${outputPath}`);
    return letter;
  }

  /** Return any forbidden phrases found in the text. */
  checkForbiddenPhrases(text: string): string[] {
    const textLC = text.toLowerCase();
    return FORBIDDEN_PHRASES.filter((phrase) => textLC.includes(phrase));
  }

  getOutputPath(jobId: string): string {
    return path.join('output', 'cover_letters', `${jobId}.md`);
  }
}
