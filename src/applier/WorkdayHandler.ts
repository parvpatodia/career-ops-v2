/**
 * Workday ATS handler (M3) — thin Applier glue over the verify-or-abstain
 * pipeline. The real work lives in unit-tested components:
 *   WorkdayDriver (Playwright)  -> scans/fills/reads the DOM
 *   WorkdaySchemaMapper (pure)  -> DOM descriptors -> FormFields
 *   WorkdayAdapter (pure)       -> IntentPayload -> fill -> read-back -> Verifier
 *
 * WHY data-automation-id: Workday's React SPA exposes stable automation IDs;
 * CSS classes are build-hashed and unreliable across tenant versions.
 *
 * WHY AnswerKB first: human-approved answers are the only ones that open the
 * legal/EEO gate (AGENTS.md invariant 7). The deterministic AnswerGenerator
 * is the fallback. Anything still uncertain abstains.
 *
 * NEVER SUBMITS: the adapter has no submit path (WorkdayPageDriver has no
 * submit method). A green run reports readyForSubmit=true and STOPS; the human
 * clicks Submit. Submission with receipts (SubmissionRecorder, M2) is a
 * deliberate future increment, gated on AGENTS.md batch-approval.
 */

import fs from 'fs';
import path from 'path';
import type { ApplyContext, ApplyResult } from './Applier.js';
import { Applier } from './Applier.js';
import { WorkdayDriver } from './WorkdayDriver.js';
import { WorkdayAdapter } from './WorkdayAdapter.js';
import type { WorkdayOutcome } from './WorkdayAdapter.js';
import type { EeoField } from './ApplicationAdapter.js';
import { AnswerKB, CompositeAnswerSource } from './AnswerKB.js';
import type { AnswerContext } from './AnswerGenerator.js';

export class WorkdayHandler extends Applier {
  readonly ats = 'workday';

  protected async fill(context: ApplyContext): Promise<ApplyResult> {
    const p = this.page!;
    await p.waitForTimeout(1_500);

    // If we landed on the job description, click Apply to reach the form.
    try {
      const applyBtn = p
        .locator('[data-automation-id="applyButton"], [data-automation-id="adventureButton"]')
        .first();
      if (await applyBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await applyBtn.click({ timeout: 5_000 });
        await p.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
        await p.waitForTimeout(1_500);
      }
    } catch (err) {
      this.log.warn(`Apply-button step skipped: ${(err as Error).message}`);
    }

    const answers = new CompositeAnswerSource([new AnswerKB(), this.answers]);
    const adapter = new WorkdayAdapter(new WorkdayDriver(p), answers);

    const ctx: AnswerContext = {
      company: context.job.company,
      role: context.job.title,
      jd: context.job.jd,
      resumeVariant: context.tailoring.resumeVariant,
    };

    const outcome = await adapter.run(ctx, context.pdfPath);

    const shotPath = path.resolve('output', `wd-${outcome.kind}-${context.job.id}.png`);
    fs.mkdirSync('output', { recursive: true });
    await p.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    this.log.info(`[WORKDAY] ${context.job.company} — ${outcome.kind} (screenshot ${shotPath})`);

    return this.toApplyResult(context, outcome, p.url(), shotPath);
  }

  /** Translate a WorkdayOutcome into the shared ApplyResult shape. */
  private toApplyResult(
    context: ApplyContext,
    outcome: WorkdayOutcome,
    url: string,
    shotPath: string
  ): ApplyResult {
    const base = {
      jobId: context.job.id,
      ats: this.ats,
      stoppedAt: url,
      notes: `Workday: ${outcome.kind}. Screenshot ${shotPath}`,
    };

    const wd = (id: string) => `[data-automation-id="${id}"]`;

    switch (outcome.kind) {
      case 'auth_required':
        return {
          ...base,
          fieldsFilledCount: 0,
          fieldsFailed: [{ selector: 'workday-auth', reason: 'Workday sign-in / create-account wall — human login required' }],
          screeningQuestions: [{
            question: 'WORKDAY AUTH REQUIRED',
            answer: '[FLAGGED] Log into Workday for this company, then re-run.',
            flagged: true,
          }],
          readyForSubmit: false,
          notes: `Workday auth wall at ${url}. Human login required.`,
        };

      case 'abstained':
        return {
          ...base,
          fieldsFilledCount: 0, // nothing is filled on an uncertain form
          fieldsFailed: outcome.reasons.map((r) => ({ selector: wd(r.fieldId), reason: r.why })),
          screeningQuestions: [
            ...outcome.reasons.map((r) => ({
              question: r.label.slice(0, 120),
              answer: `[NEEDS MANUAL INPUT] ${r.why}`,
              flagged: true,
            })),
            ...this.eeoQuestions(outcome.eeo),
          ],
          readyForSubmit: false,
        };

      case 'verify_failed': {
        const failed = outcome.verdict.checks.filter((c) => !c.pass);
        return {
          ...base,
          fieldsFilledCount: outcome.intents.length,
          fieldsFailed: failed.map((c) => ({
            selector: wd(c.fieldId),
            reason: `read-back "${c.actual ?? '<unread>'}" != expected "${c.expected}"`,
          })),
          screeningQuestions: this.eeoQuestions(outcome.eeo),
          readyForSubmit: false,
        };
      }

      case 'verified':
        return {
          ...base,
          fieldsFilledCount: outcome.intents.length,
          fieldsFailed: [],
          screeningQuestions: this.eeoQuestions(outcome.eeo),
          readyForSubmit: true, // every field read back green — human reviews + submits
          notes: `Workday: verified ${outcome.intents.length} field(s); ${outcome.skipped.length} optional skipped. Screenshot ${shotPath}`,
        };
    }
  }

  // EEO / self-identification fields are surfaced for the human, never auto-filled.
  private eeoQuestions(eeo: EeoField[]): ApplyResult['screeningQuestions'] {
    return eeo.map((e) => ({
      question: `EEO / self-identification: ${e.label}`.slice(0, 120),
      answer: '[FLAGGED] Voluntary self-ID — fill manually if you choose.',
      flagged: true,
    }));
  }
}
