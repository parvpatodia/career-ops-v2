/**
 * Orchestrates resume + cover letter tailoring for a job.
 * WHY: Single entry point for the tailoring pipeline keeps the skill
 * files simple — they call `tailor [job_id]` without worrying about
 * which sub-classes to invoke.
 */

import { ResumeBuilder } from './ResumeBuilder.js';
import { CoverLetterBuilder } from './CoverLetterBuilder.js';
import { JobParser } from '../evaluator/JobParser.js';
import type { Job, EvaluationResult, TailoringResult } from '../types.js';
import { Logger } from '../utils/Logger.js';

export class Tailor {
  private log = new Logger('Tailor');
  private resumeBuilder = new ResumeBuilder();
  private coverLetterBuilder = new CoverLetterBuilder();
  private jobParser = new JobParser();

  /**
   * Tailor a resume and optionally generate a cover letter.
   * coverLetterData must be provided by the Claude Code skill (it requires company research).
   */
  tailor(
    job: Job,
    evaluation: EvaluationResult,
    coverLetterData?: Parameters<CoverLetterBuilder['build']>[1]
  ): TailoringResult {
    const parsedJob = this.jobParser.parse(job.title, job.company, job.jd);

    // Build tailored resume
    const { outputPath: resumePath, injections } = this.resumeBuilder.build(
      job.id,
      job.title,
      evaluation.resumeVariant,
      parsedJob.keywords
    );

    let coverLetterPath: string | undefined;

    // Generate cover letter if score qualifies AND data is provided
    if (evaluation.shouldGenerateCoverLetter && coverLetterData) {
      try {
        this.coverLetterBuilder.build(job.id, coverLetterData, evaluation);
        coverLetterPath = this.coverLetterBuilder.getOutputPath(job.id);
      } catch (err) {
        this.log.warn(`Cover letter skipped for ${job.id}`, err);
      }
    }

    const result: TailoringResult = {
      jobId: job.id,
      resumeVariant: evaluation.resumeVariant,
      injectedKeywords: injections,
      tailoredResumePath: resumePath,
      coverLetterPath,
      tailoredAt: new Date().toISOString(),
    };

    // Log what was injected so the user learns WHY each choice was made
    this.log.info(`Tailored ${job.company} - ${job.title}`, {
      variant: evaluation.resumeVariant,
      keywordsInjected: injections.map((i) => i.keyword),
      hasCoverLetter: !!coverLetterPath,
    });

    for (const inj of injections) {
      this.log.info(
        `  Injected "${inj.keyword}" at ${inj.location}: ${inj.reason}`
      );
    }

    return result;
  }
}
