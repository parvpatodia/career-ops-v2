/**
 * Selects a CV variant and applies a no-fabrication injection plan to it.
 * The risky pre-M6 logic (grafting ", leveraging X" onto the best-scoring
 * bullet, which invented claims) is gone; injection decisions now live in the
 * pure InjectionPlanner and only ever grow the skills enumeration with a skill
 * Parv actually has.
 *
 * IO layer: reads cv/<variant>.md and the master CV (the attestation corpus),
 * writes the tailored markdown. Paths are injectable so tests use a fixture CV
 * dir, never real PII (LESSONS 2026-06-12).
 */

import fs from 'fs';
import path from 'path';
import type { ResumeVariant, KeywordInjection } from '../types.js';
import { Logger } from '../utils/Logger.js';
import { InjectionPlanner, type SkippedKeyword } from './InjectionPlanner.js';
import { ResumeRenderer } from './ResumeRenderer.js';

const MAX_INJECTIONS = 3;

export interface ResumeBuildResult {
  content: string;            // the tailored markdown
  injections: KeywordInjection[];
  skipped: SkippedKeyword[];
  sections: string[];         // section titles in the tailored markdown
  outputPath: string;
}

export class ResumeBuilder {
  private log = new Logger('ResumeBuilder');
  private planner = new InjectionPlanner();
  private readonly cvDir: string;
  private readonly outputDir: string;

  constructor(opts?: { cvDir?: string; outputDir?: string }) {
    this.cvDir = opts?.cvDir ?? 'cv';
    this.outputDir = opts?.outputDir ?? path.join('output', 'resumes');
  }

  /** Build a tailored resume markdown file for a specific job. */
  build(
    jobId: string,
    variant: ResumeVariant,
    jdKeywords: string[],
    maxInjections = MAX_INJECTIONS
  ): ResumeBuildResult {
    const basePath = path.join(this.cvDir, `${variant}.md`);
    if (!fs.existsSync(basePath)) {
      throw new Error(`CV variant not found: ${basePath}`);
    }

    const content = fs.readFileSync(basePath, 'utf8');
    // The master CV is the attestation corpus (the truth of what Parv has). If
    // it is absent, the variant is its own corpus: then "attested" == "already
    // present", so nothing is injected — the safe degenerate case.
    const masterPath = path.join(this.cvDir, 'master.md');
    const corpus = fs.existsSync(masterPath) ? fs.readFileSync(masterPath, 'utf8') : content;

    const plan = this.planner.plan(content, corpus, jdKeywords, maxInjections);
    const tailored = this.planner.apply(content, plan);

    const injections: KeywordInjection[] = plan.injections.map((i) => ({
      keyword: i.keyword,
      location: `skills line ${i.lineIndex + 1}`,
      reason: i.reason,
    }));

    const outputPath = path.join(this.outputDir, `${jobId}-${variant}.md`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, tailored);

    this.log.info(`Built tailored resume: ${outputPath}`, {
      variant,
      injected: injections.length,
      skipped: plan.skipped.length,
    });

    return {
      content: tailored,
      injections,
      skipped: plan.skipped,
      sections: ResumeRenderer.sectionTitles(tailored),
      outputPath,
    };
  }
}
