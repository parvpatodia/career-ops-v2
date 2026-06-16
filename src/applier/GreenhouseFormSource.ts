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

  async readBack(field: FormField): Promise<string | null> {
    if (field.type === 'file') {
      // The react uploader REMOVES the <input> after attach and renders the
      // chosen filename in a .body__secondary element. Read that text so the
      // Verifier's basename check can confirm the upload (the input is gone).
      const texts = await this.page
        .locator('[class*="body__secondary"]')
        .allInnerTexts()
        .catch(() => [] as string[]);
      const joined = texts.join(' ').trim();
      return joined.length > 0 ? joined : null;
    }
    return readControl(this.locate(field.id), field);
  }

  async clickSubmit(): Promise<void> {
    const btn = this.page
      .locator('#submit_app, button[type="submit"], button:has-text("Submit application")')
      .first();
    await btn.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await btn.click({ timeout: 10_000 });
    // Wait for the submit POST + the confirmation/redirect to render before
    // reading it, so a "submitted" verdict reflects a completed submission.
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await this.page.waitForTimeout(1_500);
  }

  async readConfirmation(): Promise<string | null> {
    // Classic boards selectors first.
    const conf = this.page.locator('#application_confirmation, [data-greenhouse-confirmation]').first();
    const text = await conf.textContent({ timeout: 3_000 }).catch(() => null);
    const trimmed = (text ?? '').replace(/\s+/g, ' ').trim();
    if (trimmed.length > 0) return trimmed;

    // New job-boards (React) form: detect a real success message or URL. If
    // neither is present the submit is NOT confirmed (returns null), so the
    // Autopilot records submitted-without-confirmed rather than a false success.
    const body = await this.page.locator('body').innerText().catch(() => '');
    const m = body.match(
      /(thank you for applying[^.\n]*|your application (has been )?(submitted|received)[^.\n]*|thanks for applying[^.\n]*|we('| ha)ve received your application[^.\n]*|application submitted[^.\n]*)/i
    );
    if (m) return m[0].replace(/\s+/g, ' ').trim().slice(0, 120);
    const url = this.page.url();
    if (/confirmation|thank|submitted|success/i.test(url)) return `submitted (url: ${url})`;
    return null;
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
