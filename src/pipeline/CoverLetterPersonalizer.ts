/**
 * Personalises the cover letter opening paragraph per job.
 * WHY: Template approach (no API calls) — fast enough for 400+ jobs.
 * Body paragraphs (projects, experience) are strong and stay unchanged.
 * Only the opener is company/role specific.
 */

import fs from 'fs';
import path from 'path';
import type { ResumeVariant } from '../types.js';

const COVER_LETTERS: Record<string, string> = {
  ai_ml: 'cv/cover_letter_ai.md',
  robotics: 'cv/cover_letter_robotics.md',
};

// Custom opening paragraph per variant — mentions role + company
const OPENINGS: Record<string, (role: string, company: string) => string> = {
  ai_ml: (role, company) =>
    `I started out curious about how machines move, and over time that curiosity grew into ` +
    `a deeper interest in how they can learn, reason, and make useful decisions from data. ` +
    `That is what led me to pursue my Master's in Artificial Intelligence at Northeastern ` +
    `University in Silicon Valley. I am applying for the ${role} position at ${company} ` +
    `and am excited to contribute to real systems and keep building at a high level.`,

  robotics: (role, company) =>
    `My interest in robotics began with a simple fascination with how machines move through ` +
    `the world, and has grown through hands-on experience in perception, autonomous systems, ` +
    `and intelligent decision-making. Today, as a Master's student in Artificial Intelligence ` +
    `at Northeastern University in Silicon Valley, I am most excited by roles like ` +
    `${role} at ${company}, where software, sensing, and real-world behavior come together.`,
};

export class CoverLetterPersonalizer {
  personalize(
    jobId: string,
    role: string,
    company: string,
    variant: ResumeVariant
  ): string {
    const templateKey = this.getTemplateKey(variant);
    const templatePath = COVER_LETTERS[templateKey];

    let letter = fs.readFileSync(templatePath, 'utf8');

    // Replace the first paragraph with the role/company-specific opening
    const opening = OPENINGS[templateKey](role, company);
    letter = this.replaceFirstParagraph(letter, opening);

    // Write to output
    const outputPath = path.join('output', 'cover_letters', `${jobId}.md`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, letter);

    return outputPath;
  }

  getOutputPath(jobId: string): string {
    return path.join('output', 'cover_letters', `${jobId}.md`);
  }

  private getTemplateKey(variant: ResumeVariant): string {
    return variant === 'robotics' ? 'robotics' : 'ai_ml';
  }

  private replaceFirstParagraph(letter: string, newParagraph: string): string {
    // Split on blank lines — first content block after the header is the opening paragraph
    const lines = letter.split('\n');
    const headerEnd = this.findHeaderEnd(lines);

    // Find the first blank line after the header (marks end of paragraph 1)
    let paraEnd = headerEnd;
    let inParagraph = false;
    for (let i = headerEnd; i < lines.length; i++) {
      if (lines[i]!.trim() !== '') inParagraph = true;
      if (inParagraph && lines[i]!.trim() === '') {
        paraEnd = i;
        break;
      }
    }

    const before = lines.slice(0, headerEnd).join('\n');
    const after = lines.slice(paraEnd).join('\n');
    return `${before}\n${newParagraph}\n${after}`;
  }

  private findHeaderEnd(lines: string[]): number {
    // Header = address block + date + "Dear Hiring Team," — ends after that line
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes('dear')) return i + 2; // skip blank line after greeting
    }
    return 6; // fallback
  }
}
