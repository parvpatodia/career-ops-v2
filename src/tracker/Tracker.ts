/**
 * Core tracker: creates and updates application records.
 * WHY: Tracker owns the business logic (duplicate prevention, status transitions,
 * ID assignment) while ApplicationStore owns persistence. Separating them
 * keeps each testable in isolation.
 */

import type { Application, ApplicationStatus, EvaluationResult, Job, ResumeVariant, TailoringResult } from '../types.js';
import { ApplicationStore } from './ApplicationStore.js';
import { StatsEngine } from './StatsEngine.js';
import { Logger } from '../utils/Logger.js';

export class Tracker {
  private log = new Logger('Tracker');
  private store = new ApplicationStore();
  private stats = new StatsEngine();

  /**
   * Record a new application from an evaluation result.
   * If the company+role already exists, updates the existing record instead.
   */
  recordEvaluation(job: Job, evaluation: EvaluationResult): Application {
    const existing = this.store.findByCompanyAndRole(job.company, job.title);

    if (existing) {
      // Update score if re-evaluated
      this.store.update(existing.id, {
        notes: `Re-evaluated: ${evaluation.score}/100. ${evaluation.reasoning}`,
      });
      this.log.info(`Updated existing application: ${job.company} — ${job.title}`);
      return this.store.getById(existing.id)!;
    }

    const id = this.store.nextId();
    const app: Application = {
      id,
      jobId: job.id,
      date: new Date().toISOString().split('T')[0]!,
      company: job.company,
      role: job.title,
      score: evaluation.score,
      url: job.url,
      status: evaluation.shouldApply ? 'Evaluated' : 'SKIP',
      resumeVariant: evaluation.resumeVariant,
      notes: evaluation.reasoning,
    };

    this.store.add(app);
    return app;
  }

  /** Mark an application as tailored (resume + optional cover letter generated). */
  recordTailoring(applicationId: string, tailoring: TailoringResult): void {
    this.store.update(applicationId, {
      pdfPath: tailoring.pdfPath,
      coverLetterPath: tailoring.coverLetterPath,
    });
  }

  /** Update application status after manual submission. */
  markApplied(applicationId: string): void {
    this.store.update(applicationId, {
      status: 'Applied',
      appliedAt: new Date().toISOString(),
    });
    this.log.info(`Marked as applied: ${applicationId}`);
  }

  /** Update status to any valid state. */
  updateStatus(applicationId: string, status: ApplicationStatus, notes?: string): void {
    const patch: Parameters<ApplicationStore['update']>[1] = { status };
    if (notes) patch.notes = notes;
    this.store.update(applicationId, patch);
    this.log.info(`Status updated: ${applicationId} → ${status}`);
  }

  getApplication(id: string): Application | undefined {
    return this.store.getById(id);
  }

  getAll(): Application[] {
    return this.store.getAll();
  }

  printStats(period: Application['status'] extends string ? 'today' | 'week' | 'month' | 'all' : never = 'today'): void {
    const all = this.store.getAll();
    const computed = this.stats.compute(all, period);
    console.log(this.stats.format(computed));
  }

  /** Return a formatted pipeline summary: counts by status. */
  pipelineSummary(): string {
    const all = this.store.getAll();
    const computed = this.stats.compute(all, 'all');
    const lines = [`Pipeline: ${all.length} total`];
    for (const [status, count] of Object.entries(computed.byStatus)) {
      lines.push(`  ${status}: ${count}`);
    }
    return lines.join('\n');
  }

  /** Find applications that need action (Evaluated but not yet Applied). */
  getPending(): Application[] {
    return this.store.getByStatus('Evaluated');
  }

  /** Check if daily LinkedIn limit would be exceeded. */
  checkDailyLinkedInLimit(limit = 25): { ok: boolean; todayCount: number } {
    const today = new Date().toISOString().split('T')[0]!;
    const todayLinkedIn = this.store
      .getAll()
      .filter((a) => a.date === today && a.status === 'Applied')
      .length;
    return { ok: todayLinkedIn < limit, todayCount: todayLinkedIn };
  }
}
