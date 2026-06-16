/**
 * Greenhouse binding for the ATS-agnostic verify-or-abstain core. Proves the
 * pipeline is multi-portal: the SAME ApplicationAdapter + Autopilot drive
 * Greenhouse, differing from Workday only here.
 *
 * WHY the schema comes from the board API, not the DOM (M2 design): the
 * boards-api job (questions=true) is the authoritative field schema — names,
 * required-ness, option submit-values. GreenhouseSchemaMapper (already tested)
 * maps it. fill/readBack then target the DOM, where Greenhouse renders each
 * field with id = the API field name. The job JSON is injected (fetched in
 * production, a fixture in the demo), so this class does no network I/O.
 *
 * EEO: demographic_questions are surfaced as eeo[] (never auto-filled); the
 * mapper already keeps them out of the fillable set (invariant 7).
 *
 * NEVER SUBMITS via the adapter: AtsFormSource has no submit method. clickSubmit
 * / readConfirmation are the SubmitDriver surface the Autopilot uses only after
 * a verified verdict + approval.
 */

import type { Page } from 'playwright';
import type { AtsFormSource, NormalizedSchema, EeoField } from './ApplicationAdapter.js';
import type { FieldIntent, FormField } from './IntentPayload.js';
import { GreenhouseSchemaMapper } from './GreenhouseSchemaMapper.js';
import { fillControl, readControl } from './DomControls.js';

export class GreenhouseFormSource implements AtsFormSource {
  readonly ats = 'greenhouse';
  private readonly mapper: GreenhouseSchemaMapper;

  constructor(
    private readonly page: Page,
    /** A boards-api job object (questions=true). Fetched in prod, fixture in demo. */
    private readonly job: Record<string, unknown>,
    mapper?: GreenhouseSchemaMapper
  ) {
    this.mapper = mapper ?? new GreenhouseSchemaMapper();
  }

  // Greenhouse job boards are public: the form is reachable without login.
  async isAuthWall(): Promise<boolean> {
    return false;
  }

  async scanSchema(): Promise<NormalizedSchema> {
    const mapped = this.mapper.map(this.job);
    return {
      fields: mapped.fields.map((f) => f.field),
      eeo: this.demographicFields(),
      unmapped: mapped.unmapped.map((u) => ({
        id: u.label,
        label: u.label,
        required: u.required,
        widget: u.type,
      })),
    };
  }

  fill(intent: FieldIntent): Promise<void> {
    return fillControl(this.page, this.locate(intent.field.id), intent);
  }

  readBack(field: FormField): Promise<string | null> {
    return readControl(this.locate(field.id), field);
  }

  async clickSubmit(): Promise<void> {
    const btn = this.page
      .locator('#submit_app, button[type="submit"], button:has-text("Submit Application")')
      .first();
    await btn.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await btn.click({ timeout: 5_000 });
  }

  async readConfirmation(): Promise<string | null> {
    const conf = this.page.locator('#application_confirmation, [data-greenhouse-confirmation]').first();
    const text = await conf.textContent({ timeout: 5_000 }).catch(() => null);
    const trimmed = (text ?? '').replace(/\s+/g, ' ').trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  // Greenhouse renders each field with id = the API field name. Attribute
  // selector (not `#id`) so a name with unusual chars can never break it.
  private locate(id: string) {
    return this.page.locator(`[id="${id}"]`).first();
  }

  private demographicFields(): EeoField[] {
    const demo = this.job.demographic_questions as
      | { questions?: Array<{ label?: unknown; fields?: Array<{ name?: unknown }> }> }
      | undefined;
    return (demo?.questions ?? []).map((q, i) => ({
      id: String(q.fields?.[0]?.name ?? `demographic_${i}`),
      label: String(q.label ?? `Demographic question ${i + 1}`),
    }));
  }
}
