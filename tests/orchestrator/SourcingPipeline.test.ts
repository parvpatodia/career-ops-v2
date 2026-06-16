/**
 * SPEC: the sourcing front-half on the v2 core. Uses the REAL FreshnessFilter +
 * TermFilter (a true integration of the gates) with a fake evaluate() and a fake
 * orchestrator, so the compose + bucket logic is verified without profile/cv/
 * browser. Dates are relative to now, so the test never rots.
 */

import { describe, it, expect } from 'vitest';
import { SourcingPipeline } from '../../src/orchestrator/SourcingPipeline.js';
import { FreshnessFilter } from '../../src/pipeline/FreshnessFilter.js';
import { TermFilter } from '../../src/pipeline/TermFilter.js';
import type { TailorGateResult } from '../../src/orchestrator/Orchestrator.js';
import type { Job, EvaluationResult, Application } from '../../src/types.js';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().split('T')[0]!;
}

function job(id: string, title: string, postedAt: string): Job {
  return {
    id, title, company: `Co-${id}`, url: `https://x/${id}`, applyUrl: `https://x/${id}`,
    platform: 'greenhouse', location: 'Remote', remote: true, postedAt, discoveredAt: daysAgo(0),
    jd: 'Build ML systems in Python.', status: 'discovered',
  };
}

function evalFor(j: Job): EvaluationResult {
  return {
    jobId: j.id, score: 80,
    breakdown: { skillMatch: 80, experienceMatch: 80, locationMatch: 80, visaMatch: 100, companySignal: 70, timingMatch: 90 },
    reasoning: 'fit', resumeVariant: 'ml', topMatchingSkills: [], missingSkills: [],
    shouldApply: j.id !== 'low',   // the "low" job fails the score gate
    shouldGenerateCoverLetter: false, evaluatedAt: daysAgo(0),
  };
}

function appFor(j: Job): Application {
  return {
    id: '001', jobId: j.id, date: daysAgo(0), company: j.company, role: j.title, score: 80,
    url: j.url, status: 'Ready', resumeVariant: 'ml', pdfPath: '/tmp/r.pdf', notes: 'greenhouse | Remote',
  };
}

class FakeOrchestrator {
  calls: string[] = [];
  async tailorAndQueue(j: Job, evaluation: EvaluationResult): Promise<TailorGateResult> {
    this.calls.push(j.id);
    if (!evaluation.shouldApply) return { phase: 'skipped_score' };
    if (j.id === 'abs') return { phase: 'tailor_abstained', reason: 'page-budget' };
    return { phase: 'queued', application: appFor(j) };
  }
}

describe('SourcingPipeline', () => {
  it('filters, scores, tailors-or-abstains, and buckets every job', async () => {
    const jobs: Job[] = [
      job('ok', 'Machine Learning Intern', daysAgo(3)),     // fresh, on-term -> queued
      job('stale', 'ML Intern', daysAgo(40)),               // dropped by freshness
      job('off', 'SWE Intern - Summer 2025', daysAgo(3)),   // dropped by term (off-season-year)
      job('low', 'Data Intern', daysAgo(3)),                // fresh, on-term, score gate -> skipped
      job('abs', 'AI Intern', daysAgo(3)),                  // fresh, on-term -> tailor abstains
    ];
    const orch = new FakeOrchestrator();
    const pipeline = new SourcingPipeline({
      freshness: new FreshnessFilter(),
      term: new TermFilter(),
      evaluate: evalFor,
      orchestrator: orch,
    });

    const s = await pipeline.run(jobs);

    expect(s.total).toBe(5);
    expect(s.stale).toBe(1);
    expect(s.offTerm).toBe(1);
    expect(s.skippedScore).toBe(1);
    expect(s.tailorAbstained).toBe(1);
    expect(s.queued).toBe(1);

    // Only fresh + on-term jobs reach tailoring; stale/off-term are filtered first.
    expect(orch.calls).toEqual(['ok', 'low', 'abs']);
    expect(orch.calls).not.toContain('stale');
    expect(orch.calls).not.toContain('off');
  });

  it('dry run previews the score gate without tailoring or queueing', async () => {
    const jobs: Job[] = [
      job('ok', 'Machine Learning Intern', daysAgo(3)),
      job('low', 'Data Intern', daysAgo(3)),
      job('stale', 'ML Intern', daysAgo(40)),
    ];
    const orch = new FakeOrchestrator();
    const s = await new SourcingPipeline({
      freshness: new FreshnessFilter(), term: new TermFilter(), evaluate: evalFor, orchestrator: orch,
    }).run(jobs, { dryRun: true });

    expect(s.queued).toBe(1);       // "ok" would queue
    expect(s.skippedScore).toBe(1); // "low" fails the score gate
    expect(s.stale).toBe(1);
    expect(orch.calls).toEqual([]); // dry run never tailors/queues
  });

  it('an unparseable posting date counts as stale, never reaches tailoring', async () => {
    const jobs: Job[] = [job('nodate', 'ML Intern', 'not-a-date')];
    const orch = new FakeOrchestrator();
    const s = await new SourcingPipeline({
      freshness: new FreshnessFilter(), term: new TermFilter(), evaluate: evalFor, orchestrator: orch,
    }).run(jobs);

    expect(s.stale).toBe(1);
    expect(s.queued).toBe(0);
    expect(orch.calls).toEqual([]); // never tailored an unprovably-fresh posting
  });
});
