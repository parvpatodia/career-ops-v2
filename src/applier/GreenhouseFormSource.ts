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
import { detectCaptcha } from './CaptchaDetector.js';

/** A control discovered from the live DOM by discoverBuiltinFields' evaluate. */
export interface RawBuiltin {
  id: string;
  label: string;
  reactSelect: boolean;
  required: boolean;
  type: string;
}

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
    const apiFields = mapped.fields.map((f) => f.field);
    // EEOC compliance fields (Gender/Veteran/Disability/Race) are fillable from
    // the human-approved AnswerKB, BUT only the ones whose id is actually in the
    // rendered DOM: the API name can diverge (Nuro's API "race" renders as
    // "hispanic_ethnicity"; [id="race"] does not exist), and filling a missing
    // element throws. Drop the divergent ones so gender/veteran/disability fill
    // and race is left to the human rather than blowing up the fill.
    const compliancePresent = await this.domPresentIds(mapped.complianceFields.map((f) => f.field.id));
    const complianceFields = mapped.complianceFields
      .map((f) => f.field)
      .filter((f) => compliancePresent.has(f.id));
    const known = new Set([
      ...apiFields.map((f) => f.id),
      ...complianceFields.map((f) => f.id),
      ...this.demographicFields().map((e) => e.id), // diversity survey: surfaced, not filled
    ]);
    // The new Greenhouse React form renders REQUIRED built-in fields (location
    // Country, etc.) that the boards questions API does NOT return, so a
    // schema-only fill verifies green yet the form rejects submit. Discover them
    // from the DOM and add them so the fill is complete.
    const builtins = await this.discoverBuiltinFields(known);
    const captcha = await detectCaptcha(this.page);
    return {
      fields: [...apiFields, ...complianceFields, ...builtins],
      eeo: this.demographicFields(),
      unmapped: mapped.unmapped.map((u) => ({
        id: u.label,
        label: u.label,
        required: u.required,
        widget: u.type,
      })),
      ...(captcha ? { captcha } : {}),
    };
  }

  /**
   * Which of the candidate ids are present in the rendered DOM. WHY: the boards-
   * API compliance field name can differ from the DOM element id, so we only mark
   * a compliance field fillable if its element exists (else the fill would throw
   * on a missing locator). With no live page (unit stub) we assume all present so
   * the pure schema mapping is still testable.
   */
  private async domPresentIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    if (typeof this.page?.evaluate !== 'function') return new Set(ids);
    const present = await this.page
      .evaluate((cand) => cand.filter((id) => !!document.querySelector(`[id="${id}"]`)), ids)
      .catch(() => ids);
    return new Set(present);
  }

  /**
   * DOM-discover labeled built-in fields the questions API omits. Conservative:
   * only fields with a usable label that are required OR a known location field
   * (Country/Location/City), excluding file inputs, EEO, captcha, and anything
   * already in the API schema. react-select controls become 'select'.
   */
  private async discoverBuiltinFields(known: Set<string>): Promise<FormField[]> {
    // No live page (unit tests with a stub) -> nothing to discover.
    if (typeof this.page?.evaluate !== 'function') return [];
    const raw = await this.page
      .evaluate(() => {
        const out: Array<{ id: string; label: string; reactSelect: boolean; required: boolean; type: string }> = [];
        const controls = document.querySelectorAll('input[id], select[id], textarea[id]');
        for (const el of Array.from(controls)) {
          const e = el as HTMLInputElement;
          if (e.type === 'hidden' || e.type === 'file') continue;
          let label = '';
          const forLabel = document.querySelector('label[for="' + e.id + '"]');
          if (forLabel) label = (forLabel as HTMLElement).innerText.trim();
          if (!label) {
            const wrap = e.closest('[class*=field]');
            const inner = wrap ? wrap.querySelector('label, .label') : null;
            if (inner) label = (inner as HTMLElement).innerText.trim();
          }
          const reactSelect = !!e.closest('.select__control');
          const required = e.required || e.getAttribute('aria-required') === 'true' || /\*/.test(label);
          out.push({ id: e.id, label: label.replace(/\*/g, '').trim(), reactSelect, required, type: e.type || '' });
        }
        return out;
      })
      .catch(() => [] as RawBuiltin[]);

    return GreenhouseFormSource.filterBuiltins(raw, known);
  }

  /**
   * Pure filter over the DOM-discovered controls. Extracted from the browser
   * evaluate so the safety-critical decision (what counts as a fillable builtin)
   * is unit-tested. Discovery exists ONLY to recover required text/select fields
   * the questions API omits (e.g. the location Country); a checkbox/radio is an
   * OPTION inside a question group ("check all that apply"), so discovering it
   * leaks every option as a phantom unknown question (the Tenstorrent bug:
   * "Austin, TX", "Summer", ... counted as separate questions).
   */
  static filterBuiltins(raw: RawBuiltin[], known: Set<string>): FormField[] {
    return raw
      .filter((f) => f.id && f.label && !known.has(f.id))
      .filter((f) => f.type !== 'checkbox' && f.type !== 'radio')
      .filter((f) => !/recaptcha|search-input/i.test(f.id))
      .filter((f) => f.required || /\b(country|location|city|state)\b/i.test(f.label))
      .map((f) => ({ id: f.id, label: f.label, type: (f.reactSelect ? 'select' : 'text') as FormField['type'], required: true }));
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
      if (joined.length > 0) return joined;
      // Fallback for a plain <input type=file> (the input is still present, e.g.
      // a classic form or the fixture): read the attached file's name directly.
      return readControl(this.locate(field.id), field);
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
