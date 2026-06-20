/**
 * The sourcing front-half, on the v2 core. Takes sourced jobs and runs them
 * through the SAME gates as the production pipeline, but tailors with the M6
 * verify-or-abstain Tailor (via Orchestrator.tailorAndQueue) instead of the v1
 * pre-built variant PDFs. The result: the Ready queue is always M6-quality, so
 * the full chain (source -> tailor -> queue -> apply) is one coherent v2 path
 * and `npm run run` no longer needs --tailor to get a verified resume.
 *
 *   FreshnessFilter (14d) -> TermFilter (Summer/Fall 2026) -> evaluate (score
 *   gate) -> Orchestrator.tailorAndQueue (M6 verify-or-abstain; a non-verified
 *   resume is NOT queued).
 *
 * Pure orchestration with injected deps, so the whole flow is unit-tested with
 * fakes (no profile, cv, browser, or network). The CLI wires the real Evaluator,
 * VariantClassifier, Tailor, and scan cache.
 */

import type { Job, EvaluationResult } from '../types.js';
import type { FreshnessFilter } from '../pipeline/FreshnessFilter.js';
import type { TermFilter } from '../pipeline/TermFilter.js';
import type { Orchestrator, TailorGateResult } from './Orchestrator.js';
import { Logger } from '../utils/Logger.js';

export interface SourcingDeps {
  freshness: FreshnessFilter;
  term: TermFilter;
  /** Score + classify a job. The CLI composes VariantClassifier + Evaluator. */
  evaluate: (job: Job) => EvaluationResult;
  /** Only tailorAndQueue is used; the apply step is a separate run. */
  orchestrator: Pick<Orchestrator, 'tailorAndQueue'>;
}

export interface SourcingSummary {
  total: number;
  stale: number;
  offTerm: number;
  skippedScore: number;
  tailorAbstained: number;
  queued: number;
  alreadySubmitted: number;
  /** Per-job outcome, in input order, for reporting. */
  outcomes: Array<{ company: string; role: string; phase: TailorGateResult['phase'] }>;
}

export class SourcingPipeline {
  private log = new Logger('sourcing');

  constructor(private readonly deps: SourcingDeps) {}

  async run(jobs: Job[], opts: { dryRun?: boolean; topN?: number } = {}): Promise<SourcingSummary> {
    const { freshness, term, evaluate, orchestrator } = this.deps;

    const { fresh, stale, unknown } = freshness.filter(jobs);
    const { matched, offTerm } = term.filter(fresh);

    const summary: SourcingSummary = {
      total: jobs.length,
      // An unparseable date is NOT fresh (invariant 9): count it as stale.
      stale: stale.length + unknown.length,
      offTerm: offTerm.length,
      skippedScore: 0,
      tailorAbstained: 0,
      queued: 0,
      alreadySubmitted: 0,
      outcomes: [],
    };

    // Evaluate every fresh, on-term job (deterministic + cheap). With topN, tailor
    // the highest-scoring first and cap the run (invariant 10: select the best
    // intern/co-op roles when bounded); otherwise keep input order (unchanged
    // default). The expensive step (M6 tailor + PDF) thus runs only on the best N.
    let work = matched.map((job) => ({ job, evaluation: evaluate(job) }));
    if (opts.topN && opts.topN > 0) {
      work = [...work].sort((a, b) => b.evaluation.score - a.evaluation.score).slice(0, opts.topN);
    }

    for (const { job, evaluation } of work) {
      // Dry run: preview the score gate without tailoring (no PDF render, no
      // queue write). `queued` counts would-queue jobs by shouldApply alone; it
      // does NOT consult idempotency, so an already-submitted job shows as
      // would-queue here (the real run returns already_submitted). Preview only.
      if (opts.dryRun) {
        const phase: TailorGateResult['phase'] = evaluation.shouldApply ? 'queued' : 'skipped_score';
        if (evaluation.shouldApply) summary.queued++; else summary.skippedScore++;
        summary.outcomes.push({ company: job.company, role: job.title, phase });
        continue;
      }

      const result = await orchestrator.tailorAndQueue(job, evaluation);
      summary.outcomes.push({ company: job.company, role: job.title, phase: result.phase });

      switch (result.phase) {
        case 'skipped_score': summary.skippedScore++; break;
        case 'tailor_abstained':
          summary.tailorAbstained++;
          this.log.warn(`Tailor abstained: ${job.company} — ${job.title}: ${result.reason}`);
          break;
        case 'queued': summary.queued++; break;
        case 'already_submitted': summary.alreadySubmitted++; break;
      }
    }

    this.log.info(
      `Sourcing: ${summary.queued} queued, ${summary.tailorAbstained} tailor-abstained, ` +
      `${summary.skippedScore} below score, ${summary.offTerm} off-term, ${summary.stale} stale, ` +
      `${summary.alreadySubmitted} already submitted (of ${summary.total})`
    );
    return summary;
  }
}
