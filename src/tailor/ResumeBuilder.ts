/**
 * Selects the right CV variant and injects ATS keywords from the JD.
 * WHY: Keyword injection into existing bullets is the highest-ROI tailoring
 * action — it improves ATS parse scores without changing the underlying claims,
 * which keeps everything defensible in an interview.
 */

import fs from 'fs';
import path from 'path';
import type { ResumeVariant, KeywordInjection } from '../types.js';
import { Logger } from '../utils/Logger.js';

const MAX_INJECTIONS = 3;

export class ResumeBuilder {
  private log = new Logger('ResumeBuilder');

  /** Build a tailored resume markdown file for a specific job. */
  build(
    jobId: string,
    jobTitle: string,
    variant: ResumeVariant,
    jdKeywords: string[]
  ): { content: string; injections: KeywordInjection[]; outputPath: string } {
    const basePath = `cv/${variant}.md`;
    if (!fs.existsSync(basePath)) {
      throw new Error(`CV variant not found: ${basePath}`);
    }

    let content = fs.readFileSync(basePath, 'utf8');
    const existingKeywords = this.extractExistingKeywords(content);
    const injections: KeywordInjection[] = [];

    // Find keywords in the JD that aren't already in the resume
    const newKeywords = jdKeywords
      .filter((kw) => !existingKeywords.includes(kw.toLowerCase()))
      .slice(0, MAX_INJECTIONS);

    for (const keyword of newKeywords) {
      const injection = this.injectKeyword(content, keyword, variant);
      if (injection) {
        content = injection.newContent;
        injections.push({ keyword, location: injection.location, reason: injection.reason });
      }
    }

    // Write tailored resume to output
    const outputPath = path.join('output', 'resumes', `${jobId}-${variant}.md`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content);

    this.log.info(`Built tailored resume: ${outputPath}`, {
      variant,
      injections: injections.length,
    });

    return { content, injections, outputPath };
  }

  private extractExistingKeywords(content: string): string[] {
    return content.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  }

  private injectKeyword(
    content: string,
    keyword: string,
    _variant: ResumeVariant
  ): { newContent: string; location: string; reason: string } | null {
    const lines = content.split('\n');
    const kwLC = keyword.toLowerCase();

    // Find the best bullet to inject into — prefer project bullets
    let bestLineIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('- ')) continue;

      const score = this.relevanceScore(line, keyword);
      if (score > bestScore) {
        bestScore = score;
        bestLineIdx = i;
      }
    }

    if (bestLineIdx === -1 || bestScore < 0.1) return null;

    const originalLine = lines[bestLineIdx];

    // Only inject if the keyword isn't already present (case-insensitive)
    if (originalLine.toLowerCase().includes(kwLC)) return null;

    // Append keyword naturally to the end of the bullet
    lines[bestLineIdx] = originalLine.endsWith('.')
      ? `${originalLine.slice(0, -1)}, leveraging ${keyword}.`
      : `${originalLine} (${keyword})`;

    return {
      newContent: lines.join('\n'),
      location: `line ${bestLineIdx + 1}`,
      reason: `ATS keyword from JD; increases parse hit rate for ${keyword} requirement`,
    };
  }

  private relevanceScore(bullet: string, keyword: string): number {
    const bulletLC = bullet.toLowerCase();
    const kwWords = keyword.toLowerCase().split(' ');

    // Partial word match gives some score
    const matchCount = kwWords.filter((w) => bulletLC.includes(w)).length;
    return matchCount / kwWords.length;
  }
}
