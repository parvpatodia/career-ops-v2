/**
 * Type-safe loader for config/profile.yml.
 *
 * WHY a dedicated loader instead of raw yaml.load():
 * - Fails fast at startup with a clear error (missing field, wrong structure)
 *   rather than throwing TypeError deep inside a fill() call at runtime.
 * - URL normalization (https:// prefix) happens once here, not scattered
 *   across handlers, eliminating the double-protocol bug.
 * - Single source of truth: every handler calls getIdentity() and gets
 *   the same, validated, normalized data.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// ── Types ─────────────────────────────────────────────────────────────────

export interface IdentityProfile {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin: string;    // always starts with https://
  github: string;      // always starts with https://
  portfolio: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  location: string;    // "City, State"
  university: string;
  program: string;
  gpa: string;
  graduation: string;
}

export interface WorkAuth {
  visaType: string;
  authorizedNow: boolean;
  requiresSponsorshipNow: boolean;
  requiresSponsorshipFuture: boolean;
  sponsorshipAnswer: string;
}

export interface Compensation {
  internshipHourlyTarget: number;
  internshipHourlyMin: number;
  internshipHourlyMax: number;
  fulltimeAnnualTarget: number;
  fulltimeAnnualMin: number;
  fulltimeAnnualMax: number;
}

export interface ApplicationDefaults {
  howDidYouHear: string;
  aboutMeShort: string;
  startDate: string;    // ISO date: "2026-05-11"
  endDate: string;      // ISO date: computed from startDate
  backgroundCheckConsent: boolean;
  drugTestConsent: boolean;
}

// ── Loader ────────────────────────────────────────────────────────────────

export class ProfileLoader {
  private readonly raw: Record<string, unknown>;

  constructor(profilePath = 'config/profile.yml') {
    const resolved = path.resolve(profilePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Profile not found: ${resolved}. Run scripts/setup.sh or create config/profile.yml from config/profile.example.yml.`
      );
    }
    this.raw = yaml.load(fs.readFileSync(resolved, 'utf8')) as Record<string, unknown>;
    this.validate();
  }

  private validate(): void {
    const identity = this.raw['identity'];
    if (!identity || typeof identity !== 'object') {
      throw new Error(
        'profile.yml is missing the "identity" section. Check config/profile.yml.'
      );
    }
    const id = identity as Record<string, unknown>;
    const required = ['name', 'email', 'phone', 'linkedin', 'github'] as const;
    for (const field of required) {
      const val = id[field];
      if (!val || (typeof val === 'string' && val.trim() === '')) {
        throw new Error(
          `profile.yml identity.${field} is required but missing or empty. Fill it in config/profile.yml.`
        );
      }
    }
  }

  getIdentity(): IdentityProfile {
    const id = this.raw['identity'] as Record<string, unknown>;
    const name = String(id['name'] ?? '').trim();
    const parts = name.split(/\s+/);
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');

    const city = String(id['city'] ?? '');
    const state = String(id['state'] ?? '');

    return {
      name,
      firstName,
      lastName,
      email: String(id['email'] ?? ''),
      phone: String(id['phone'] ?? ''),
      linkedin: this.normalizeUrl(id['linkedin']),
      github: this.normalizeUrl(id['github']),
      portfolio: id['portfolio'] && id['portfolio'] !== 'null'
        ? this.normalizeUrl(id['portfolio'])
        : null,
      address: String(id['address'] ?? ''),
      city,
      state,
      zip: String(id['zip'] ?? ''),
      location: [city, state].filter(Boolean).join(', '),
      university: String(id['university'] ?? ''),
      program: String(id['program'] ?? ''),
      gpa: String(id['gpa'] ?? ''),
      graduation: String(id['graduation'] ?? ''),
    };
  }

  getWorkAuth(): WorkAuth {
    const wa = (this.raw['work_authorization'] ?? {}) as Record<string, unknown>;
    return {
      visaType: String(wa['visa_type'] ?? 'F-1'),
      authorizedNow: Boolean(wa['authorized_to_work_now'] ?? true),
      requiresSponsorshipNow: Boolean(wa['requires_sponsorship_now'] ?? false),
      requiresSponsorshipFuture: Boolean(wa['requires_sponsorship_future'] ?? true),
      sponsorshipAnswer: String(wa['sponsorship_answer'] ?? ''),
    };
  }

  getCompensation(): Compensation {
    const c = (this.raw['compensation'] ?? {}) as Record<string, unknown>;
    return {
      internshipHourlyTarget: Number(c['internship_hourly_target'] ?? 45),
      internshipHourlyMin: Number(c['internship_hourly_min'] ?? 30),
      internshipHourlyMax: Number(c['internship_hourly_max'] ?? 65),
      fulltimeAnnualTarget: Number(c['fulltime_annual_target'] ?? 140000),
      fulltimeAnnualMin: Number(c['fulltime_annual_min'] ?? 110000),
      fulltimeAnnualMax: Number(c['fulltime_annual_max'] ?? 180000),
    };
  }

  getApplicationDefaults(): ApplicationDefaults {
    const d = (this.raw['application_defaults'] ?? {}) as Record<string, unknown>;
    const tr = (this.raw['target_roles'] ?? {}) as Record<string, unknown>;
    const startDate = String(tr['start_date'] ?? '2026-05-11');

    return {
      howDidYouHear: String(d['how_did_you_hear'] ?? 'LinkedIn'),
      aboutMeShort: String(d['about_me_short'] ?? ''),
      startDate,
      endDate: ProfileLoader.computeEndDate(startDate),
      backgroundCheckConsent: Boolean(d['background_check_consent'] ?? true),
      drugTestConsent: Boolean(d['drug_test_consent'] ?? true),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // WHY: strip any existing protocol before prepending, so we never produce
  // "https://https://..." regardless of what the user typed in profile.yml.
  private normalizeUrl(raw: unknown): string {
    if (!raw) return '';
    const s = String(raw).trim();
    if (!s) return '';
    const stripped = s.replace(/^https?:\/\//, '');
    return `https://${stripped}`;
  }

  // Summer (May-Jul) → Aug 15; Fall (Aug-Oct) → Dec 15; else +3 months
  static computeEndDate(startDate: string): string {
    const start = new Date(startDate);
    const month = start.getMonth(); // 0-indexed
    if (month >= 4 && month <= 6) {
      return `${start.getFullYear()}-08-15`;
    }
    if (month >= 7 && month <= 9) {
      return `${start.getFullYear()}-12-15`;
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 3);
    return end.toISOString().split('T')[0]!;
  }
}
