/**
 * Workday binding for the ATS-agnostic verify-or-abstain core
 * (ApplicationAdapter). The orchestration lives in ApplicationAdapter; this
 * file only adapts Workday's DOM scan + mapper to the shared AtsFormSource.
 *
 * WHY the split: the fill+verify logic is identical for every portal; only
 * schema discovery and selectors differ. Workday and Greenhouse share one
 * tested core, differing only in their FormSource.
 *
 * NEVER SUBMITS: WorkdayPageDriver (and AtsFormSource) have no submit method,
 * so the filler is structurally unable to submit. Submission is the Autopilot's
 * gated job.
 */

import { WorkdaySchemaMapper } from './WorkdaySchemaMapper.js';
import type { WorkdayRawField } from './WorkdaySchemaMapper.js';
import type { FieldIntent, FormField, AnswerSource } from './IntentPayload.js';
import type { Verifier } from './Verifier.js';
import type { SubmissionRecorder } from './SubmissionRecorder.js';
import { ApplicationAdapter } from './ApplicationAdapter.js';
import type { AtsFormSource, NormalizedSchema, ApplicationOutcome } from './ApplicationAdapter.js';

/** Back-compat alias: the Workday outcome is the generic application outcome. */
export type WorkdayOutcome = ApplicationOutcome;

/**
 * The narrow, submit-free page surface a Workday driver exposes to the schema
 * source. scan() returns raw DOM descriptors; interpretation is the mapper's.
 */
export interface WorkdayPageDriver {
  isAuthWall(): Promise<boolean>;
  scan(): Promise<WorkdayRawField[]>;
  fill(intent: FieldIntent): Promise<void>;
  readBack(field: FormField): Promise<string | null>;
}

/** Adapts a Workday page driver + the DOM mapper to the ATS-agnostic source. */
export class WorkdayFormSource implements AtsFormSource {
  readonly ats = 'workday';

  constructor(
    private readonly driver: WorkdayPageDriver,
    private readonly mapper: WorkdaySchemaMapper = new WorkdaySchemaMapper()
  ) {}

  isAuthWall(): Promise<boolean> {
    return this.driver.isAuthWall();
  }

  async scanSchema(): Promise<NormalizedSchema> {
    const s = this.mapper.map(await this.driver.scan());
    return {
      fields: s.fields.map((f) => f.field),
      eeo: s.eeo.map((e) => ({ id: e.automationId, label: e.label })),
      unmapped: s.unmapped.map((u) => ({ id: u.automationId, label: u.label, required: u.required, widget: u.widget })),
    };
  }

  fill(intent: FieldIntent): Promise<void> {
    return this.driver.fill(intent);
  }

  readBack(field: FormField): Promise<string | null> {
    return this.driver.readBack(field);
  }
}

export interface WorkdayAdapterOptions {
  /** 12-hex app id (events.appIdFor). Required for event recording to happen. */
  appId?: string;
  /** Records fill_verified / abstained. Omitted in stub demos to avoid touching the log. */
  recorder?: SubmissionRecorder;
  mapper?: WorkdaySchemaMapper;
  verifier?: Verifier;
}

export class WorkdayAdapter extends ApplicationAdapter {
  constructor(driver: WorkdayPageDriver, answers: AnswerSource, opts: WorkdayAdapterOptions = {}) {
    super(new WorkdayFormSource(driver, opts.mapper), answers, {
      ...(opts.appId !== undefined ? { appId: opts.appId } : {}),
      ...(opts.recorder !== undefined ? { recorder: opts.recorder } : {}),
      ...(opts.verifier !== undefined ? { verifier: opts.verifier } : {}),
    });
  }
}
