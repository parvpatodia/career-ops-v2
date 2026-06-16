/**
 * Orchestrates resume + cover-letter tailoring for a job, end to end, under the
 * same verify-or-abstain discipline as the apply engine:
 *
 *   extract ATS keywords (full JD) -> plan no-fabrication injection -> render ->
 *   VERIFY (independent ResumeVerifier) -> only if green: render the PDF and
 *   gate it on a page budget. A verification failure ABSTAINS: no pdfPath is
 *   set, the reason is surfaced, and a damaged/dishonest resume never ships.
 *
 * Split so the pure pipeline (tailorResume: extract/plan/render/verify) is
 * unit-testable without a browser; the PDF render (tailor) is the thin IO step,
 * exercised by demo:tailor. Paths are injectable so tests use fixtures, no PII.
 */

import { ResumeBuilder } from './ResumeBuilder.js';
import { CoverLetterBuilder, type CoverLetterData } from './CoverLetterBuilder.js';
import { ResumeRenderer } from './ResumeRenderer.js';
import { ResumeVerifier, type ResumeVerdict } from './ResumeVerifier.js';
import { KeywordExtractor } from './KeywordExtractor.js';
import { PdfGenerator } from '../pdf/PdfGenerator.js';
import { ProfileLoader } from '../applier/ProfileLoader.js';
import { contactFacts } from './identity.js';
import type { SkippedKeyword } from './InjectionPlanner.js';
import type { Job, EvaluationResult, TailoringResult, KeywordInjection, ResumeVariant } from '../types.js';
import { Logger } from '../utils/Logger.js';
import path from 'path';

const MAX_RESUME_PAGES = 2;

export interface TailorOptions {
  profilePath?: string;
  cvDir?: string;
  templatePath?: string;
  outputDir?: string;
  coverTemplatePath?: string;
  coverOutputDir?: string;
  resumeBudget?: { maxVisibleChars?: number };
}

export interface ResumeTailorResult {
  variant: ResumeVariant;
  tailoredResumePath: string;
  html: string;
  injections: KeywordInjection[];
  skipped: SkippedKeyword[];
  sections: string[];
  verdict: ResumeVerdict;
  verified: boolean;
}

export class Tailor {
  private log = new Logger('Tailor');
  private keywordExtractor = new KeywordExtractor();
  private resumeBuilder: ResumeBuilder;
  private renderer: ResumeRenderer;
  private verifier = new ResumeVerifier();
  private coverLetterBuilder: CoverLetterBuilder;
  private pdfGenerator: PdfGenerator;
  private readonly opts: TailorOptions;
  private profileLoaderCache?: ProfileLoader;

  constructor(opts: TailorOptions = {}) {
    this.opts = opts;
    const outputDir = opts.outputDir ?? path.join('output', 'resumes');
    this.resumeBuilder = new ResumeBuilder({ cvDir: opts.cvDir, outputDir });
    this.renderer = new ResumeRenderer(opts.templatePath);
    this.pdfGenerator = new PdfGenerator(outputDir);
    this.coverLetterBuilder = new CoverLetterBuilder({
      templatePath: opts.coverTemplatePath,
      outputDir: opts.coverOutputDir,
    });
  }

  private profile(): ProfileLoader {
    if (!this.profileLoaderCache) this.profileLoaderCache = new ProfileLoader(this.opts.profilePath);
    return this.profileLoaderCache;
  }

  /**
   * The pure pipeline: extract -> plan -> render -> verify. Writes the tailored
   * markdown (a build artifact) but launches no browser. `verified` is the gate.
   */
  tailorResume(job: Job, variant: ResumeVariant): ResumeTailorResult {
    const extraction = this.keywordExtractor.extract(job.jd);
    const keywords = extraction.abstained ? [] : extraction.keywords.map((k) => k.term);
    if (extraction.abstained) {
      this.log.warn(`Keyword extraction abstained for ${job.id}: ${extraction.reason}`);
    }

    const build = this.resumeBuilder.build(job.id, variant, keywords);
    const identity = contactFacts(this.profile().getIdentity());
    const html = this.renderer.renderHtml(build.content, identity);

    const verdict = this.verifier.verify({
      renderedHtml: html,
      identity,
      requiredSections: build.sections,
      claimedKeywords: build.injections.map((i) => i.keyword),
      budget: this.opts.resumeBudget,
    });

    return {
      variant,
      tailoredResumePath: build.outputPath,
      html,
      injections: build.injections,
      skipped: build.skipped,
      sections: build.sections,
      verdict,
      verified: verdict.pass,
    };
  }

  /** Full tailoring: resume (verify-or-abstain + PDF) and optional cover letter. */
  async tailor(
    job: Job,
    evaluation: EvaluationResult,
    coverLetterData?: CoverLetterData
  ): Promise<TailoringResult> {
    const resume = this.tailorResume(job, evaluation.resumeVariant);

    let pdfPath: string | undefined;
    let abstainReason: string | undefined;

    if (!resume.verified) {
      abstainReason = this.failureSummary(resume.verdict);
      this.log.warn(`Resume ABSTAINED for ${job.id}; not rendering PDF: ${abstainReason}`);
    } else {
      const pdfTarget = path.join(this.opts.outputDir ?? path.join('output', 'resumes'), `${job.id}-${resume.variant}.pdf`);
      const pdf = await this.pdfGenerator.htmlToPdf(resume.html, pdfTarget);
      if (pdf.bytes > 0 && pdf.pageCount >= 1 && pdf.pageCount <= MAX_RESUME_PAGES) {
        pdfPath = pdf.pdfPath;
      } else {
        abstainReason = `PDF render check failed: ${pdf.pageCount} pages (budget ${MAX_RESUME_PAGES}), ${pdf.bytes} bytes`;
        this.log.warn(`Resume PDF ABSTAINED for ${job.id}: ${abstainReason}`);
      }
    }

    let coverLetterPath: string | undefined;
    if (evaluation.shouldGenerateCoverLetter && coverLetterData) {
      try {
        const id = this.profile().getIdentity();
        const res = this.coverLetterBuilder.build(job.id, coverLetterData, evaluation, {
          groundingFacts: [id.name, id.university].filter(Boolean),
        });
        coverLetterPath = res.outputPath;
      } catch (err) {
        this.log.warn(`Cover letter abstained/skipped for ${job.id}`, err);
      }
    }

    const result: TailoringResult = {
      jobId: job.id,
      resumeVariant: resume.variant,
      injectedKeywords: resume.injections,
      skippedKeywords: resume.skipped.map((s) => s.keyword),
      tailoredResumePath: resume.tailoredResumePath,
      pdfPath,
      coverLetterPath,
      // "verified" means end-to-end shippable: the ResumeVerifier passed AND a
      // PDF was rendered within budget. A PDF-render failure abstains too, so we
      // never report verified:true alongside an abstainReason.
      verified: resume.verified && !!pdfPath,
      abstainReason,
      tailoredAt: new Date().toISOString(),
    };

    this.log.info(`Tailored ${job.company} - ${job.title}`, {
      variant: resume.variant,
      injected: resume.injections.map((i) => i.keyword),
      skipped: result.skippedKeywords,
      verified: resume.verified,
      hasPdf: !!pdfPath,
      hasCoverLetter: !!coverLetterPath,
    });

    return result;
  }

  private failureSummary(verdict: ResumeVerdict): string {
    return verdict.checks
      .filter((c) => !c.pass)
      .map((c) => `${c.name}: ${c.detail}`)
      .join('; ');
  }
}
